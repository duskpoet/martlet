import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import { openClient } from "./driver.js";
import { MartletError } from "./errors.js";
import { loadMigrations } from "./files.js";

const DEFAULT_TABLE = "schema_migrations";

function invalidOptions(message) {
  return new MartletError("invalid_options", message);
}

/** Quotes a table name, optionally schema-qualified ("schema.table"). */
function quoteTable(table) {
  if (typeof table !== "string" || table === "") {
    throw invalidOptions("table must be a non-empty string");
  }
  return table
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".");
}

/** Fixed advisory lock key for a tracking table: first 8 bytes of sha256, as a signed bigint. */
function lockKey(table) {
  return createHash("sha256")
    .update(`martlet:${table}`)
    .digest()
    .readBigInt64BE(0)
    .toString();
}

function normalizeOptions(options) {
  if (!options || typeof options !== "object") {
    throw invalidOptions("options must be an object");
  }
  const { databaseUrl, sql, dir, table = DEFAULT_TABLE, logger } = options;
  if (!sql && !databaseUrl) {
    throw invalidOptions("Pass either databaseUrl or sql");
  }
  if (sql && databaseUrl) {
    throw invalidOptions("Pass databaseUrl or sql, not both");
  }
  if (sql && typeof sql.savepoint === "function") {
    // martlet commits once per migration, which would commit the caller's transaction
    throw invalidOptions(
      "sql must be a client or a reserved connection, not a transaction",
    );
  }
  if (typeof dir !== "string" || !isAbsolute(dir)) {
    throw invalidOptions("dir must be an absolute path");
  }
  if (logger != null && typeof logger.info !== "function") {
    throw invalidOptions("logger must have an info(msg, fields) method");
  }
  const info = (msg, fields) => {
    if (!logger) return;
    try {
      // fire and forget; also swallow rejections from async loggers
      Promise.resolve(logger.info(msg, fields)).catch(() => {});
    } catch {
      // a broken logger must not interrupt a migration
    }
  };
  return {
    sql,
    databaseUrl,
    dir,
    table: quoteTable(table),
    tableName: table,
    info,
  };
}

async function transaction(q, fn) {
  await q("begin");
  try {
    const result = await fn();
    await q("commit");
    return result;
  } catch (err) {
    await q("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Runs `fn` on one dedicated connection holding the advisory lock for the
 * tracking table, after the table exists and applied files are verified.
 */
async function withLockedState(options, fn) {
  const opts = normalizeOptions(options);
  const migrations = await loadMigrations(opts.dir);
  const client = await openClient(opts);
  try {
    const conn =
      typeof client.sql.reserve === "function"
        ? await client.sql.reserve()
        : client.sql;
    try {
      const q = (text, params) =>
        params ? conn.unsafe(text, params) : conn.unsafe(text);
      // qualify the name so "t" and "public.t" share one lock: use the schema the
      // existing table resolves to, else current_schema() (where it will be created)
      let qualified = opts.tableName;
      if (!qualified.includes(".")) {
        const [{ schema }] = await q(
          `select coalesce(
             (select n.nspname from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              where c.oid = to_regclass($1)),
             current_schema()) as schema`,
          [opts.table],
        );
        if (schema) qualified = `${schema}.${qualified}`;
      }
      const key = lockKey(qualified);
      await q("select pg_advisory_lock($1::bigint)", [key]);
      try {
        const applied = await prepareTable(q, opts);
        verify(applied, migrations);
        return await fn({ q, opts, migrations, applied });
      } finally {
        await q("select pg_advisory_unlock($1::bigint)", [key]).catch(
          () => {},
        );
      }
    } finally {
      if (conn !== client.sql) conn.release();
    }
  } finally {
    await client.close();
  }
}

/** Creates the tracking table if needed, then returns the applied rows in version order. */
async function prepareTable(q, opts) {
  const { table } = opts;
  const columns = (
    await q(
      `select attname from pg_attribute
       where attrelid = to_regclass($1) and attnum > 0 and not attisdropped`,
      [table],
    )
  ).map((row) => row.attname);

  if (columns.length === 0) {
    await q(`create table ${table} (
      version integer primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
  } else if (!["version", "name", "checksum"].every((c) => columns.includes(c))) {
    throw new MartletError(
      "invalid_table",
      `Table ${table} exists but is not a martlet tracking table`,
    );
  }

  return q(`select version, name, checksum from ${table} order by version`);
}

function verify(applied, migrations) {
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  for (const row of applied) {
    const migration = byVersion.get(row.version);
    if (!migration) {
      throw new MartletError(
        "missing_migration",
        `Migration ${row.name} (version ${row.version}) was applied but its file is missing`,
      );
    }
    if (migration.name !== row.name) {
      throw new MartletError(
        "missing_migration",
        `Migration ${row.name} was applied but its file is missing (found ${migration.name} with the same version)`,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MartletError(
        "checksum_mismatch",
        `Migration ${migration.name} was edited after it was applied`,
      );
    }
  }
  const current = currentVersion(applied);
  const appliedVersions = new Set(applied.map((row) => row.version));
  const skipped = migrations.find(
    (m) => m.version < current && !appliedVersions.has(m.version),
  );
  if (skipped) {
    throw new MartletError(
      "unapplied_migration",
      `Migration ${skipped.name} is older than the current version ${current} but was never applied`,
    );
  }
}

function currentVersion(applied) {
  return applied.length ? applied[applied.length - 1].version : 0;
}

/**
 * Runs each migration's `pick(m)` SQL with its `track(m)` statement in one
 * transaction per migration. Returns the versions that ran, in order.
 * Any failure, including one raised at commit (deferred constraints), is a
 * `migration_failed` naming the migration.
 */
async function applyEach(q, opts, list, { pick, track, before, after }) {
  const done = [];
  for (const migration of list) {
    const fields = { version: migration.version, file: migration.name };
    opts.info(before(migration), fields);
    try {
      await transaction(q, async () => {
        await q(pick(migration));
        await q(...track(migration));
      });
    } catch (err) {
      if (err instanceof MartletError) throw err;
      throw new MartletError(
        "migration_failed",
        `Migration ${migration.name} failed: ${err.message}`,
        { cause: err },
      );
    }
    done.push(migration.version);
    opts.info(after(migration), fields);
  }
  return done;
}

export function up(options) {
  return withLockedState(options, async ({ q, opts, migrations, applied }) => {
    const from = currentVersion(applied);
    opts.info(`Current version: ${from}`, { version: from });
    const done = await applyEach(
      q,
      opts,
      migrations.filter((m) => m.version > from),
      {
        pick: (m) => m.up,
        track: (m) => [
          `insert into ${opts.table} (version, name, checksum) values ($1, $2, $3)`,
          [m.version, m.name, m.checksum],
        ],
        before: (m) => `Applying ${m.name}`,
        after: (m) => `Migrated to version ${m.version}`,
      },
    );
    return { from, to: done.length ? done[done.length - 1] : from, applied: done };
  });
}

export function down(version, options) {
  if (!Number.isInteger(version) || version < 0) {
    return Promise.reject(
      new MartletError("invalid_target", "version must be a non-negative integer"),
    );
  }
  return withLockedState(options, async ({ q, opts, migrations, applied }) => {
    const from = currentVersion(applied);
    opts.info(`Current version: ${from}`, { version: from });
    if (version > from) {
      throw new MartletError(
        "invalid_target",
        `Cannot migrate down to version ${version}: current version is ${from}`,
      );
    }
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    const toRevert = applied
      .filter((row) => row.version > version)
      .reverse()
      .map((row) => byVersion.get(row.version));
    const done = await applyEach(q, opts, toRevert, {
      pick: (m) => m.down,
      track: (m) => [`delete from ${opts.table} where version = $1`, [m.version]],
      before: (m) => `Reverting ${m.name}`,
      after: (m) => `Reverted ${m.name}`,
    });
    const remaining = applied.filter((row) => row.version <= version);
    return { from, to: currentVersion(remaining), applied: done };
  });
}
