#!/usr/bin/env node

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { down, up, MartletError } from "./src/index.js";

const HELP = `Usage: martlet up [options]
       martlet down <version> [options]
       <version> is the version to migrate down to (0 reverts everything)

Options:
  --dir <dir>           Migrations directory, default "migrations"
  --database-url <url>  Database URL, default is the DATABASE_URL environment variable
  --table <name>        Tracking table, default "schema_migrations"
  -h, --help            Show this help`;

/** Hides the password in any URL (user:password@ and ?password=). */
function redact(text) {
  return String(text)
    // greedy up to the last "@" in the token: credentials may hold a raw "@", "/", "?" or "#"
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/]*:)\S*@/gi, "$1***@")
    .replace(/([?&]password=)[^&\s]*/gi, "$1***");
}

const print = (msg) => console.log(redact(msg));
const logger = { info: (msg) => print(msg) };

function fail(message) {
  console.error(redact(`martlet: ${message}`));
  return 1;
}

async function main(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        dir: { type: "string", default: "migrations" },
        "database-url": { type: "string" },
        table: { type: "string" },
        driver: { type: "string" }, // deprecated (0.1.x), only "pg" is supported
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    fail(err.message);
    console.error(HELP);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }
  const isUp = command === "up" && rest.length === 0;
  const isDown =
    command === "down" && rest.length === 1 && /^\d+$/.test(rest[0]);
  if (!isUp && !isDown) {
    console.error(HELP);
    return 1;
  }
  if (values.driver !== undefined && values.driver !== "pg") {
    return fail(`Unsupported --driver ${values.driver}: only pg is supported`);
  }
  const databaseUrl = values["database-url"] ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    return fail("No database URL: pass --database-url or set DATABASE_URL");
  }
  const options = {
    databaseUrl,
    dir: resolve(values.dir),
    table: values.table,
    logger,
  };

  print(`Migrating ${command} ${databaseUrl}`);
  const result = isUp
    ? await up(options)
    : await down(Number(rest[0]), options);
  print(
    result.applied.length
      ? `Done: version ${result.from} -> ${result.to}`
      : `Nothing to do, at version ${result.to}`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    fail(err instanceof MartletError ? err.message : (err?.stack ?? err));
    process.exitCode = 1;
  },
);
