import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { MartletError } from "./errors.js";

export const SEPARATOR = "-- up/down --";
const MIGRATION_FILE = /^(\d+)_.+\.sql$/;
const MAX_VERSION = 2147483647; // the tracking column is a postgres integer

/** Checksum of a migration's up part. Line endings are normalised so a CRLF checkout doesn't count as an edit. */
export function checksum(upSql) {
  return createHash("sha256")
    .update(upSql.replace(/\r\n/g, "\n"))
    .digest("hex");
}

/**
 * Reads `<version>_<name>.sql` files from `dir`, ignoring everything else.
 * Returns them sorted by version, with the up and down parts split.
 */
export async function loadMigrations(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    throw new MartletError(
      "invalid_options",
      `Cannot read migrations directory ${dir}: ${err.message}`,
      { cause: err },
    );
  }

  const byVersion = new Map();
  for (const name of names) {
    const match = MIGRATION_FILE.exec(name);
    if (!match) continue;
    const version = Number(match[1]);
    if (version < 1 || version > MAX_VERSION) {
      throw new MartletError(
        "invalid_migration",
        `Migration ${name} has version ${match[1]}; versions must be between 1 and ${MAX_VERSION}`,
      );
    }
    const existing = byVersion.get(version);
    if (existing) {
      throw new MartletError(
        "duplicate_version",
        `Migrations ${existing.name} and ${name} have the same version ${version}`,
      );
    }
    byVersion.set(version, { version, name });
  }

  const migrations = [...byVersion.values()].sort(
    (a, b) => a.version - b.version,
  );
  for (const migration of migrations) {
    const text = await readFile(join(dir, migration.name), "utf-8");
    const idx = text.indexOf(SEPARATOR);
    if (idx === -1) {
      throw new MartletError(
        "invalid_migration",
        `Migration ${migration.name} does not contain '${SEPARATOR}'`,
      );
    }
    migration.up = text.slice(0, idx);
    migration.down = text.slice(idx + SEPARATOR.length);
    migration.checksum = checksum(migration.up);
  }
  return migrations;
}
