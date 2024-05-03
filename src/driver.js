import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES = {
  pg: "postgres@3.4.4",
};

class PGAdapter {
  constructor(driver) {
    this.driver = driver;
  }

  async connect(url) {
    this.sql = this.driver(url);
  }

  async transact(query) {
    return this.sql.begin((sql) => {
      return query((text) => sql.unsafe(text));
    });
  }

  async close() {
    await this.sql.end();
  }
}

const downloadDriver = async (driver) => {
  const pkg = PACKAGES[driver];
  if (!pkg) {
    throw new Error(`Unknown driver: ${driver}`);
  }
  spawnSync("npm", ["install", "--no-save", pkg], {
    stdio: "inherit",
  });
};

export async function loadAdapter(driver) {
  await downloadDriver(driver);
  return import(PACKAGES[driver].split("@")[0]).then(
    (m) => new PGAdapter(m.default)
  );
}
