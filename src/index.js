import { printHelp } from "./help.js";
import { doUp } from "./up.js";
import { parseOptions } from "./options.js";
import { doDown } from "./down.js";

if (process.argv[2] === "up") {
  const options = parseOptions(process.argv.slice(3));
  doUp(options);
} else if (process.argv[2] === "down") {
  const version = parseInt(process.argv[3]);
  if (isNaN(version)) {
    console.error("Version must be a number");
    process.exit(1);
  }
  const options = parseOptions(process.argv.slice(4));
  doDown(version, options);
} else {
  printHelp();
}

process.on("unhandledRejection", (err) => {
  console.error(err);
  process.exit(1);
});
