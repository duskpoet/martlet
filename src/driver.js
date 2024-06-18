import { spawnSync } from "node:child_process";
import { stat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  try {
    await stat(join(process.cwd(), "yarn.lock"));
    const lockfile = await readFile(join(process.cwd(), "yarn.lock"));
    const packagejson = await readFile(join(process.cwd(), "package.json"));
    spawnSync("yarn", ["add", pkg], {
      stdio: "inherit",
    });
    await writeFile(join(process.cwd(), "yarn.lock"), lockfile);
    await writeFile(join(process.cwd(), "package.json"), packagejson);
    return;
  } catch {}
  spawnSync("npm", ["install", "--no-save", "--legacy-peer-deps", pkg], {
    stdio: "inherit",
  });
};

export async function loadAdapter(driver) {
  await downloadDriver(driver);
  return import(PACKAGES[driver].split("@")[0]).then(
    (m) => new PGAdapter(m.default),
  );
}
