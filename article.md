# Coding exercise: database migration tool in nodejs

## Requirements
I want to have a database migration tool, that has the following properties:
1. Every migration is written in a single SQL file, meaning both "up" and "down" parts. This will allow Copilot to fill in the rollback migration. And the fact that it's a bare SQL also makes it the most flexible and supported solution.
2. The currently applied version should be managed by the tool. I want the tool to be self-sufficient.
3. I want the tool to support different databases, such as Postgres, MySQL, SQL Server, etc., so it should be extendable in that sense.
4. I don't want it to be oversized, so only drivers for the necessary database should be installed, ideally on demand.
5. I want it to be part of the javascript ecosystem since most of the projects I work on are a part of it.
6. Every migration should be performed inside of a transaction.

## Introduction
A lot of these points were born from my experience with this awesome tool called [tern](https://github.com/JackC/tern). I was sad that javascript doesn't have the same! (Or maybe I suck at googling...). So I decided this could be a nice coding exercise for myself and a story that could be interesting to someone else :)

## Development

### Part 1. Designing the tool
Let's ~~steal~~ design the CLI tool! 
1. All migrations would have the following naming scheme: `<number>_<name>.sql`, where the number would represent the migration version number, for example, `001_initial_setup.sql`.
2. All migrations would reside in a single dir.
3. Database driver would be downloaded on demand, either some pre-bundled package or just issuing some sort of `npm install <driver>`.

So the syntax for the tool would be the following: `martlet up --database-url <url> --driver <driver> --dir <dir>` or `martlet down <version> <same options>`.

Where "up" should apply all migations that are not applied yet and down should rollback to the specified version.
Options have the following meaning and defaults:
- **database-url** - connection string for the database, the default would be to lookup the env variable `DATABASE_URL`
- **driver** - database driver to use. For the first version, I will only support Postgres with an option named "pg".
- **dir** - directory where migrations reside, default is `migrations`

As you can see, I've started with figuring out how I would invoke the tool before writing any actual code. This is a good practice, it helps to realize requirements and reduce development cycles.

### Part 2. Implementation

#### 2.1 Parsing options
Ok, first things first! Let's create an index.js file and output the help message. It would look something like this:
```javascript
function printHelp() {
  console.log(
    "Usage: martlet up --driver <driver> --dir <dir> --database-url <url>",
  );
  console.log(
    "       martlet down <version> --driver <driver> --dir <dir> --database-url <url>",
  );
  console.log(
    "       <version> is a number that specifies the version to migrate down to",
  );
  console.log("Options:");
  console.log('  --driver <driver>  Driver to use, default is "pg"');
  console.log('  --dir <dir>        Directory to use, default is "migrations"');
  console.log(
    "  --database-url <url> Database URL to use, default is DATABASE_URL environment variable",
  );
}

printHelp();
```

Now we will parse options:
```javascript
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
```

As you can see, I don't use any library for parsing; I just simply iterate over the arguments list and process every option. So, if I have a boolean option, I would shift the iteration index by 1, and if I have an option with a value, I would shift it by 2.

#### 2.2 Implementing the driver adapter
To support multiple drivers, we need to have some universal interface to access a database; here is how it may look:
```typescript
interface Adapter {
    connect(url: string): Promise<void>;
    transact(query: (fn: (text) => Promise<ResultSet>)): Promise<ResultSet>;
    close(): Promise<void>;
}
```

I think `connect` and `close` are pretty obvious functions, let me explain the `transact` method. It should accept a function that would be called with a function that accepts a query text and returns a promise with an intermediate result. This complexity is required to have a general interface that would provide ability to run multiple queries inside of a transaction. It's easier to grasp by looking at the usage example.

So this is how the adapter looks for the postgres driver:
```javascript
class PGAdapter {
  constructor(driver) {
    this.driver = driver;
  }

  async connect(url) {
    this.sql = this.driver(url);
  }

  async transact(query) {
    return this.sql.begin((sql) => (
      query((text) => sql.unsafe(text))
    ));
  }

  async close() {
    await this.sql.end();
  }
}
```

And the usage example could be:
```javascript
import postgres from "postgres";

const adapter = new PGAdapter(postgres);
await adapter.connect(url);
await adapter.transact(async (sql) => {
    const rows = await sql("SELECT * FROM table1");
    await sql(`INSERT INTO table2 (id) VALUES (${rows[0].id})`);
});
```

#### 2.3 On-demand driver installation

```javascript
const PACKAGES = {
  pg: "postgres@3.4.4",
};

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
```
        
We try to install the driver with yarn at first, but we don't want to generate any diffs in the directory, so we preserve `yarn.lock` and `package.json` files. If yarn is not available, we will fall back to npm.

When we ensured that the driver is installed, we can create an adapter and use it:
```javascript
export async function loadAdapter(driver) {
  await downloadDriver(driver);
  return import(PACKAGES[driver].split("@")[0]).then(
    (m) => new PGAdapter(m.default),
  );
```

#### 2.4 Implementing the migration logic

We start by connecting to the database and getting the current version:
```javascript
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
```

Then, we read the migrations directory and sort them by version. After that, we apply every migration that has a version greater than the current one. I will just present the actual migration in the following snippet:
```javascript
await adapter.transact(async (sql) => {
    await sql(upMigration);
    await sql(
      `insert into schema_migrations (version) values (${version})`
    );
    await sql(`delete from schema_migrations where version != ${version}`);
});
```

The rollback migration is similar, but we sort the migrations in reverse order and apply them until we reach the desired version.


### 3. Testing
I decided not to use any specific testing framework but use the built-in nodejs testing capabilities. They include the test runner and the assertion package.
```javascript
import { it, before, after, describe } from "node:test";
import assert from "node:assert";
```
And to execute tests I would run `node --test --test-concurrency=1`.

Actually, I was writing the code in a sort of TDD manner. I didn't validate that my migrations code worked by hand, but I was writing it along with tests. That's why I decided that end-to-end tests would be the best fit for this tool.
For such an approach, tests would need to bootstrap an empty database, apply some migrations, check that database contents are correct, and then roll back to the initial state and validate that the database is empty.
To run a database, I used the "testcontainers" library, which provides a nice wrapper around docker.
```javascript
before(async () => {
    console.log("Starting container");
    container = await new GenericContainer("postgres:16-alpine")
    .withExposedPorts(5432)
    .withEnvironment({ POSTGRES_PASSWORD: "password" })
    .start();
});

after(async () => {
    await container.stop();
});
```

I wrote some simple migrations and tested that they worked as expected. Here is an example of a database state validation:
```javascript
const sql = pg(`postgres://postgres:password@localhost:${port}/postgres`);
const result = await sql`select * from schema_migrations`;
assert.deepEqual(result, [{ version: 2 }]);
const tables =
    await sql`select table_name from information_schema.tables where table_schema = 'public'`;
assert.deepEqual(tables, [
    { table_name: "schema_migrations" },
    { table_name: "test" },
]);
```

### 4. Conclusion
This was an example of how I would approach the development of a simple CLI tool in the javascript ecosystem. I want to note that the modern javascript ecosystem is pretty charged and powerful, and I managed to implement the tool with a minimum of external dependencies. I used a postgres driver that would be downloaded on demand and testcontainers for tests. I think that approach gives developers the most flexibility and control over the application.

### 5. References
- [martlet repo](https://github.com/duskpoet/martlet)
- [tern](https://github.com/JackC/tern)
- [postgres driver](https://github.com/porsager/postgres)
