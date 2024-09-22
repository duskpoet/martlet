import { printHelp } from "./help.js";

export function parseOptions(args) {
  const options = {
    dir: "migrations",
    driver: "pg",
    databaseUrl: process.env.DATABASE_URL,
  };
  for (let idx = 0; idx < args.length; ) {
    switch (args[idx]) {
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
      }
      case "--dir": {
        options.dir = args[idx + 1];
        idx += 2;
        break;
      }
      case "--driver": {
        options.driver = args[idx + 1];
        idx += 2;
        break;
      }
      case "--database-url": {
        options.databaseUrl = args[idx + 1];
        idx += 2;
        break;
      }

      default: {
        console.error(`Unknown option: ${args[idx]}`);
        printHelp();
        process.exit(1);
      }
    }
  }
  return options;
}
