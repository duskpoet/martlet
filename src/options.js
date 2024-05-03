import { printHelp } from "./help.js";

export function parseOptions(startIdx) {
  let idx = startIdx;
  const options = {
    dir: "migrations",
    driver: "pg",
    databaseUrl: process.env.DATABASE_URL,
  };
  while (idx < process.argv.length) {
    switch (process.argv[idx]) {
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
      }
      case "--dir": {
        options.dir = process.argv[idx + 1];
        idx += 2;
        break;
      }
      case "--driver": {
        options.driver = process.argv[idx + 1];
        idx += 2;
        break;
      }
      case "--database-url": {
        options.databaseUrl = process.argv[idx + 1];
        idx += 2;
        break;
      }

      default: {
        console.error(`Unknown option: ${process.argv[idx]}`);
        printHelp();
        process.exit(1);
      }
    }
  }
  return options;
}
