import { MartletError } from "./errors.js";

/**
 * Returns the client to run migrations with. A caller-provided `sql` is used
 * as is and never closed; without one, `postgres` is imported lazily and a
 * single-connection client is created from `databaseUrl`.
 */
export async function openClient({ sql, databaseUrl }) {
  if (sql) {
    return { sql, close: async () => {} };
  }

  let postgres;
  try {
    ({ default: postgres } = await import("postgres"));
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      throw new MartletError(
        "driver_missing",
        'The "postgres" package (^3.4) is required when using databaseUrl. Install it with: npm install postgres',
        { cause: err },
      );
    }
    throw err;
  }

  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  return { sql: client, close: () => client.end({ timeout: 5 }) };
}
