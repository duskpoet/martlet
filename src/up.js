import { SEPARATOR } from "./consts.js";
import { loadAdapter } from "./driver.js";
import { readdir, readFile } from "node:fs/promises";

export async function doUp(options) {
  console.log("Doing up with options", options);
  const adapter = await loadAdapter(options.driver);
  await adapter.connect(options.databaseUrl);
  console.log("Connected to database");

  const currentVersion = await adapter.transact(async (sql) => {
    await sql(`create table if not exists schema_migrations (
      version integer primary key
      )`);
    const result = await sql(`select version from schema_migrations limit 1`);
    return result[0]?.version || 0;
  });

  console.log(`Current version: ${currentVersion}`);

  const migrationFiles = await readdir(options.dir);
  migrationFiles.sort((file1, file2) => {
    const version1 = parseInt(file1.split("_")[0]);
    const version2 = parseInt(file2.split("_")[0]);
    return version1 - version2;
  });

  for (const file of migrationFiles) {
    const version = parseInt(file.split("_")[0]);
    if (version > currentVersion) {
      console.log(`Migrating to version ${version}`);
      const migration = await readFile(`${options.dir}/${file}`, "utf-8");
      const migrationSplitIdx = migration.indexOf(SEPARATOR);
      if (migrationSplitIdx === -1) {
        throw new Error(`Migration ${file} does not contain '${SEPARATOR}'`);
      }
      const upMigration = migration.substring(0, migrationSplitIdx);
      console.log(upMigration);
      await adapter.transact(async (sql) => {
        await sql(upMigration);
        await sql(
          `insert into schema_migrations (version) values (${version})`
        );
        await sql(`delete from schema_migrations where version != ${version}`);
      });
      console.log(`Migrated to version ${version}`);
    }
  }

  await adapter.close();
}
