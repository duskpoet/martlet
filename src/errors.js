/**
 * Every error martlet raises on its own is a MartletError with a stable `code`.
 * Database errors raised while running a migration are wrapped as
 * `migration_failed`, with the original error as `cause`.
 */
export class MartletError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "MartletError";
    this.code = code;
  }
}
