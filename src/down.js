import { readdir, readFile } from "node:fs/promises";

import { SEPARATOR } from "./consts.js";
import { loadAdapter } from "./driver.js";

export async function doDown(targetVersion, options) {
  const adapter = await loadAdapter(options.driver);
  await adapter.connect(options.databaseUrl);
  console.log("Connected to database");
  const currentVersion = await adapter.transact((sql) =>
    sql(`select version from schema_migrations limit 1`).then(
      (result) => +result[0]?.version || 0
    )
  );
  console.log(`Current version: ${currentVersion}`);
  if (targetVersion >= currentVersion) {
    console.error(`Cannot migrate down to version ${targetVersion}`);
    process.exit(1);
  }
  const migrationFiles = await readdir(options.dir);
  migrationFiles.sort((file1, file2) => {
    const version1 = parseInt(file1.split("_")[0]);
    const version2 = parseInt(file2.split("_")[0]);
    return version2 - version1;
  });
  console.log("FILES", migrationFiles);
  for (const file of migrationFiles) {
    const version = parseInt(file.split("_")[0]);
    if (version <= currentVersion && version > targetVersion) {
      console.log(`Migrating to version ${version}`);
      const migration = await readFile(`${options.dir}/${file}`, "utf-8");
      const migrationSplitIdx = migration.indexOf(SEPARATOR);
      if (migrationSplitIdx === -1) {
        throw new Error(`Migration ${file} does not contain '${SEPARATOR}'`);
      }

      const downMigration = migration.substring(
        migrationSplitIdx + SEPARATOR.length
      );
      console.log(downMigration);
      await adapter.transact(async (sql) => {
        await sql(downMigration);
        await sql(
          `insert into schema_migrations (version) values (${version - 1})`
        );
        await sql(
          `delete from schema_migrations where version != ${version - 1}`
        );
      });
      console.log(`Migrated to version ${version - 1}`);
    }
  }

  await adapter.close();
}
