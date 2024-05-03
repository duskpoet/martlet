export function printHelp() {
  console.log("Usage: martlet up --driver <driver> --dir <dir>");
  console.log("       martlet down <version> --driver <driver> --dir <dir>");
  console.log(
    "       <version> is a number that specifies the version to migrate down to"
  );
  console.log("Options:");
  console.log('  --driver <driver>  Driver to use, default is "pg"');
  console.log('  --dir <dir>        Directory to use, default is "migrations"');
  console.log(
    "  --database-url <url> Database URL to use, default is DATABASE_URL environment variable"
  );
}
