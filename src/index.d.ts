import type { Sql } from "postgres";

export interface Logger {
/** Not awaited; throws and rejections are ignored. */
  info(msg: string, fields?: object): void | Promise<void>;
}

interface BaseOptions {
  /** Absolute path to the migrations directory, resolved by the caller. */
  dir: string;
  /** Tracking table, optionally schema-qualified. Default: "schema_migrations". */
  table?: string;
  /** Receives version transitions and file names. Default: silent. */
  logger?: Logger;
}

export type MigrateOptions = BaseOptions &
  (
    | { /** Martlet creates and closes its own client. */ databaseUrl: string; sql?: undefined }
    | { /** An existing client; martlet won't close it. */ sql: Sql<any>; databaseUrl?: undefined }
  );

export interface MigrateResult {
  /** Version before the run. 0 means nothing applied. */
  from: number;
  /** Version after the run. */
  to: number;
  /** Versions applied (up) or reverted (down), in the order they ran. */
  applied: number[];
}

export type MartletErrorCode =
  | "invalid_options"
  | "invalid_target"
  | "invalid_migration"
  | "invalid_table"
  | "duplicate_version"
  | "checksum_mismatch"
  | "missing_migration"
  | "unapplied_migration"
  | "migration_failed"
  | "driver_missing";

export class MartletError extends Error {
  readonly name: "MartletError";
  readonly code: MartletErrorCode;
  constructor(code: MartletErrorCode, message: string, options?: ErrorOptions);
}

/** Applies every pending migration. */
export function up(options: MigrateOptions): Promise<MigrateResult>;

/** Reverts applied migrations with a version greater than `version`. */
export function down(version: number, options: MigrateOptions): Promise<MigrateResult>;
