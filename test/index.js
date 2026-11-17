import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import postgres from "postgres";
import { GenericContainer, Wait } from "testcontainers";

import { down, up, MartletError } from "../src/index.js";
import { checksum } from "../src/files.js";

const run = promisify(execFile);
const PASSWORD = "Sup3r-s3cret-pw";
const LIB_URL = pathToFileURL(resolve("src/index.js")).href;

const M1 = `create table test (id serial primary key, name text);
-- up/down --
drop table test;`;
const M2 = `alter table test add column age int;
-- up/down --
alter table test drop column age;`;
const M3 = `create table test3 (id int references test (id));
-- up/down --
drop table test3;`;

// postgres.js returns Result arrays; compare their plain JSON shape.
const deepEqual = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

async function migrationsDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "martlet-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

async function publicTables(sql) {
  const rows = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  return rows.map((row) => row.table_name);
}

describe("martlet", () => {
  let container;
  let admin;
  let dbCount = 0;
  const clients = [];
  const dirs = [];

  const urlFor = (db) =>
    `postgres://postgres:${PASSWORD}@localhost:${container.getMappedPort(5432)}/${db}`;

  /** A fresh database per test, plus a client for assertions. */
  async function freshDb() {
    const db = `t${++dbCount}`;
    await admin.unsafe(`create database ${db}`);
    const sql = postgres(urlFor(db), { onnotice: () => {} });
    clients.push(sql);
    return { url: urlFor(db), sql };
  }

  async function dir(files) {
    const d = await migrationsDir(files);
    dirs.push(d);
    return d;
  }

  before(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withExposedPorts(5432)
      .withEnvironment({ POSTGRES_PASSWORD: PASSWORD })
      // the image restarts after initdb: wait for the second "ready" line
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start();
    admin = postgres(urlFor("postgres"), { onnotice: () => {} });
  });

  after(async () => {
    await Promise.all(clients.map((sql) => sql.end()));
    await admin?.end();
    await container?.stop();
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("applies everything from an empty database, in order", async () => {
    const { url, sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2, "003_c.sql": M3 });

    const result = await up({ databaseUrl: url, dir: d });

    deepEqual(result, { from: 0, to: 3, applied: [1, 2, 3] });
    const rows = await sql`select version, name, checksum from schema_migrations order by version`;
    deepEqual(rows, [
      { version: 1, name: "001_a.sql", checksum: checksum(M1.split("-- up/down --")[0]) },
      { version: 2, name: "002_b.sql", checksum: checksum(M2.split("-- up/down --")[0]) },
      { version: 3, name: "003_c.sql", checksum: checksum(M3.split("-- up/down --")[0]) },
    ]);
    deepEqual(await publicTables(sql), ["schema_migrations", "test", "test3"]);
  });

  it("is a no-op when already current", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2 });

    await up({ sql, dir: d });
    const again = await up({ sql, dir: d });

    deepEqual(again, { from: 2, to: 2, applied: [] });
    // the caller's client is not closed by martlet
    deepEqual(await sql`select 1 as ok`, [{ ok: 1 }]);
  });

  it("applies only the new migrations on a later run", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1 });
    await up({ sql, dir: d });
    await writeFile(join(d, "002_b.sql"), M2);
    await writeFile(join(d, "003_c.sql"), M3);

    deepEqual(await up({ sql, dir: d }), { from: 1, to: 3, applied: [2, 3] });
  });

  it("applies each migration once when two instances run concurrently", async () => {
    const { url, sql } = await freshDb();
    const d = await dir({
      "001_log.sql": `create table log (v int primary key);
        select pg_sleep(0.5);
        insert into log values (1);
        -- up/down --
        drop table log;`,
      "002_log.sql": "insert into log values (2);\n-- up/down --\n",
      "003_log.sql": "insert into log values (3);\n-- up/down --\n",
    });

    const results = await Promise.all([
      up({ databaseUrl: url, dir: d }),
      up({ databaseUrl: url, dir: d }),
    ]);

    const applied = results.map((r) => r.applied).sort((a, b) => a.length - b.length);
    deepEqual(applied, [[], [1, 2, 3]]);
    deepEqual(await sql`select v from log order by v`, [{ v: 1 }, { v: 2 }, { v: 3 }]);
    assert.equal((await sql`select count(*)::int as n from schema_migrations`)[0].n, 3);
  });

  it("shares the lock between qualified and unqualified names of one table", async () => {
    const { url, sql } = await freshDb();
    await sql`create schema tenant`;
    const d = await dir({ "001_log.sql": "create table public.log (v int primary key);\n-- up/down --\n" });
    await up({ sql, dir: d, table: "public.schema_migrations" });
    await writeFile(
      join(d, "002_log.sql"),
      "select pg_sleep(0.5); insert into public.log values (2);\n-- up/down --\n",
    );
    // unqualified name resolves to public, although current_schema() is tenant
    const tenantSql = postgres(url, { connection: { search_path: "tenant,public" }, onnotice: () => {} });
    clients.push(tenantSql);

    const results = await Promise.all([
      up({ sql: tenantSql, dir: d }),
      up({ sql, dir: d, table: "public.schema_migrations" }),
    ]);

    deepEqual(results.map((r) => r.applied).sort((a, b) => a.length - b.length), [[], [2]]);
    deepEqual(await sql`select v from public.log`, [{ v: 2 }]);
  });

  it("refuses to run when an applied file was edited", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2 });
    await up({ sql, dir: d });
    await writeFile(join(d, "001_a.sql"), M1.replace("name text", "name varchar"));
    await writeFile(join(d, "003_c.sql"), M3);

    await assert.rejects(up({ sql, dir: d }), (err) => {
      assert.ok(err instanceof MartletError);
      assert.equal(err.code, "checksum_mismatch");
      assert.match(err.message, /001_a\.sql/);
      return true;
    });
    deepEqual(await publicTables(sql), ["schema_migrations", "test"]);
    deepEqual(await sql`select version from schema_migrations order by version`, [
      { version: 1 },
      { version: 2 },
    ]);
  });

  it("refuses to run when an applied file is missing", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2 });
    await up({ sql, dir: d });
    await unlink(join(d, "002_b.sql"));
    await writeFile(join(d, "003_c.sql"), M3);

    await assert.rejects(up({ sql, dir: d }), { code: "missing_migration" });
    deepEqual(await publicTables(sql), ["schema_migrations", "test"]);
  });

  it("treats a renamed applied file as missing", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1 });
    await up({ sql, dir: d });
    await rename(join(d, "001_a.sql"), join(d, "001_renamed.sql"));

    await assert.rejects(up({ sql, dir: d }), (err) => {
      assert.equal(err.code, "missing_migration");
      assert.match(err.message, /001_a\.sql.*001_renamed\.sql/);
      return true;
    });
  });

  it("refuses a table that isn't a martlet tracking table", async () => {
    const { sql } = await freshDb();
    await sql`create table schema_migrations (version integer primary key)`;
    const d = await dir({ "001_a.sql": M1 });

    await assert.rejects(up({ sql, dir: d }), { code: "invalid_table" });
    deepEqual(await publicTables(sql), ["schema_migrations"]);
  });

  it("reverts down to a version", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2, "003_c.sql": M3 });
    await up({ sql, dir: d });

    deepEqual(await down(1, { sql, dir: d }), { from: 3, to: 1, applied: [3, 2] });
    deepEqual(await publicTables(sql), ["schema_migrations", "test"]);
    deepEqual(await sql`select version from schema_migrations`, [{ version: 1 }]);
    await assert.rejects(down(2, { sql, dir: d }), { code: "invalid_target" });
    deepEqual(await down(0, { sql, dir: d }), { from: 1, to: 0, applied: [1] });
  });

  it("rolls back a failing migration together with its tracking row", async () => {
    const { sql } = await freshDb();
    const d = await dir({
      "001_a.sql": M1,
      "002_bad.sql": "create table half (id int); select nope;\n-- up/down --\n",
    });

    await assert.rejects(up({ sql, dir: d }), (err) => {
      assert.equal(err.code, "migration_failed");
      assert.match(err.message, /002_bad\.sql/);
      return true;
    });
    deepEqual(await publicTables(sql), ["schema_migrations", "test"]);
    deepEqual(await sql`select version from schema_migrations`, [{ version: 1 }]);
  });

  it("reports a failure at commit as migration_failed", async () => {
    const { sql } = await freshDb();
    const d = await dir({
      "001_a.sql": M1,
      "002_deferred.sql": `create table child (
        test_id int references test (id) deferrable initially deferred);
        insert into child values (42);
        -- up/down --
        drop table child;`,
    });

    await assert.rejects(up({ sql, dir: d }), (err) => {
      assert.equal(err.code, "migration_failed");
      assert.match(err.message, /002_deferred\.sql/);
      return true;
    });
    deepEqual(await publicTables(sql), ["schema_migrations", "test"]);
    deepEqual(await sql`select version from schema_migrations`, [{ version: 1 }]);
  });

  it("never logs the password", async () => {
    const { url, sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1, "002_b.sql": M2 });
    const lines = [];
    const logger = { info: (msg, fields) => lines.push(msg + JSON.stringify(fields ?? {})) };

    await up({ databaseUrl: url, dir: d, logger });
    await down(0, { databaseUrl: url, dir: d, logger });

    assert.ok(lines.some((l) => l.includes("001_a.sql")), "logs file names");
    assert.ok(lines.every((l) => !l.includes(PASSWORD)), lines.join("\n"));
    assert.ok(lines.every((l) => !/create table/i.test(l)), "does not log SQL");
    deepEqual(await publicTables(sql), ["schema_migrations"]);
  });

  it("CLI runs up and down without printing the password", async () => {
    const { url, sql } = await freshDb();
    const cli = (...args) =>
      run(process.execPath, ["cli.js", ...args, "--dir", "test/migrations", "--database-url", url]);

    const upOut = await cli("up");
    const downOut = await cli("down", "1");

    for (const { stdout, stderr } of [upOut, downOut]) {
      assert.ok(!stdout.includes(PASSWORD) && !stderr.includes(PASSWORD), stdout + stderr);
    }
    assert.match(upOut.stdout, /postgres:\*\*\*@localhost/);
    assert.match(upOut.stdout, /0 -> 2/);
    assert.match(downOut.stdout, /2 -> 1/);
    deepEqual(await sql`select version from schema_migrations`, [{ version: 1 }]);
  });

  it("CLI redacts the password in errors and exits non-zero", async () => {
    const badUrl = urlFor("does_not_exist");
    const err = await run(process.execPath, [
      "cli.js",
      "up",
      "--dir",
      "test/migrations",
      "--database-url",
      badUrl,
    ]).then(
      () => assert.fail("expected a failure"),
      (e) => e,
    );
    assert.equal(err.code, 1);
    assert.ok(!(err.stdout + err.stderr).includes(PASSWORD), err.stdout + err.stderr);
  });

  it("CLI redacts a password containing a raw @", async () => {
    const url = `postgres://postgres:p@ss-${PASSWORD}@localhost:${container.getMappedPort(5432)}/postgres`;
    const err = await run(process.execPath, ["cli.js", "up", "--dir", "test/migrations", "--database-url", url]).then(
      () => assert.fail("expected an authentication failure"),
      (e) => e,
    );
    const output = err.stdout + err.stderr;
    assert.ok(!output.includes(`ss-${PASSWORD}`), output);
    assert.match(err.stdout, /postgres:\*\*\*@localhost/);
  });

  it("CLI redacts a password containing a raw /", async () => {
    const url = `postgres://postgres:pa/ss-${PASSWORD}@localhost:1/postgres`;
    const err = await run(process.execPath, ["cli.js", "up", "--dir", "test/migrations", "--database-url", url]).then(
      () => assert.fail("expected an invalid URL failure"),
      (e) => e,
    );
    const output = err.stdout + err.stderr;
    assert.ok(!output.includes(`ss-${PASSWORD}`), output);
    assert.match(err.stdout, /postgres:\*\*\*@localhost/);
  });

  it("ignores non-migration files", async () => {
    const { sql } = await freshDb();
    const d = await dir({
      "001_a.sql": M1,
      "README.md": "# migrations",
      ".gitkeep": "",
      "draft.sql": "this is not sql",
      "002_notes.txt": "nope",
    });

    deepEqual(await up({ sql, dir: d }), { from: 0, to: 1, applied: [1] });
  });

  it("rejects duplicate versions before connecting", async () => {
    const d = await dir({ "001_a.sql": M1, "001_b.sql": M2 });
    await assert.rejects(
      up({ databaseUrl: "postgres://nobody@127.0.0.1:1/none", dir: d }),
      { name: "MartletError", code: "duplicate_version" },
    );
  });

  it("rejects bad options", async () => {
    await assert.rejects(up({ databaseUrl: "postgres://x", dir: "relative" }), {
      code: "invalid_options",
    });
    await assert.rejects(up({ dir: "/tmp" }), { code: "invalid_options" });
  });

  it("rejects a transaction as sql but accepts a reserved connection", async () => {
    const { sql } = await freshDb();
    const d = await dir({ "001_a.sql": M1 });

    await assert.rejects(
      sql.begin((tx) => up({ sql: tx, dir: d })),
      { code: "invalid_options" },
    );
    const reserved = await sql.reserve();
    try {
      deepEqual(await up({ sql: reserved, dir: d }), { from: 0, to: 1, applied: [1] });
    } finally {
      reserved.release();
    }
  });

  it("has no side effects on import", async () => {
    const script = `
      const argv = process.argv;
      let argvRead = false;
      Object.defineProperty(process, "argv", { get() { argvRead = true; return argv; } });
      let exitCalled = false;
      process.exit = () => { exitCalled = true; };
      const listeners = () => process.listenerCount("unhandledRejection") + process.listenerCount("uncaughtException");
      const before = listeners();
      const lib = await import(${JSON.stringify(LIB_URL)});
      await new Promise((r) => setTimeout(r, 50));
      console.log(JSON.stringify({
        argvRead, exitCalled, addedListeners: listeners() - before, exports: Object.keys(lib).sort(),
      }));`;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script, "up"]);
    deepEqual(JSON.parse(stdout), {
      argvRead: false,
      exitCalled: false,
      addedListeners: 0,
      exports: ["MartletError", "down", "up"],
    });
  });

  it("names the package when postgres is missing", async () => {
    const d = await dir({ "001_a.sql": M1 });
    const hook = `export async function resolve(specifier, context, next) {
      if (specifier === "postgres") {
        const err = new Error("Cannot find package 'postgres'");
        err.code = "ERR_MODULE_NOT_FOUND";
        throw err;
      }
      return next(specifier, context);
    }`;
    const script = `
      import { register } from "node:module";
      register("data:text/javascript," + encodeURIComponent(${JSON.stringify(hook)}));
      const { up } = await import(${JSON.stringify(LIB_URL)});
      try { await up({ databaseUrl: "postgres://x@127.0.0.1:1/x", dir: ${JSON.stringify(d)} }); }
      catch (err) { console.log(JSON.stringify({ code: err.code, message: err.message })); }`;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script]);
    const result = JSON.parse(stdout);
    assert.equal(result.code, "driver_missing");
    assert.match(result.message, /"postgres"/);
  });
});
