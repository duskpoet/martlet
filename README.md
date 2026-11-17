<p align="center">
    <img src="https://github.com/duskpoet/martlet/blob/main/martlet.webp" alt="Martlet" width="100">
    <br />
    <em>Migrate your database schema in a simple manner.</em>
</p>

Martlet project provides a seamless way to manage database schema versions leveraging PostgreSQL (other databases will be added later). Through a CLI interface, users can execute up or down migrations. Each migration runs in its own transaction together with its tracking row. Runs are serialised with a Postgres advisory lock, and martlet stops before applying anything if an applied migration was edited or deleted.


## Installation

Requires Node.js 20+. [`postgres`](https://github.com/porsager/postgres) is a peer dependency:

```bash
npm i martlet postgres
```

## Usage

Put migration files in a directory named `migrations` in the root of your project. Files should have the following naming pattern:
```
<version>_<name>.sql
```
**Example:**
```
001_create_table.sql
002_add_column.sql
```

Inside the migration file, you can write SQL statements to create or modify the database schema. The up queries should be separated from the down queries by a `-- up/down --` comment.

**Example:**
```sql
create table users (
    id serial primary key,
    name text not null
);

-- up/down --

drop table users;
```

```bash
npx martlet --help
```

### Commands

#### Up

```bash
npx martlet up --database-url postgres://user:password@localhost:5432/dbname
```

#### Down

```bash
npx martlet down 0 --database-url postgres://user:password@localhost:5432/dbname
```

Other options: `--dir <dir>` (default `migrations`), `--table <name>` (default `schema_migrations`). `DATABASE_URL` is used when `--database-url` is not given.

### Library

Importing `martlet` has no side effects. Errors are thrown as `MartletError` with a `code` (`checksum_mismatch`, `missing_migration`, `duplicate_version`, `migration_failed`, ...).

```js
import { resolve } from "node:path";
import { up, down } from "martlet";

// with an existing postgres.js client (martlet won't close it)
await up({ sql, dir: resolve("migrations") });

// or with a URL; martlet opens and closes its own connection
const { from, to, applied } = await up({
  databaseUrl: process.env.DATABASE_URL,
  dir: resolve("migrations"),
  logger: { info: (msg, fields) => console.log(msg, fields) }, // default: silent
});

await down(0, { sql, dir: resolve("migrations") });
```

`dir` must be absolute. Only files matching `<number>_<name>.sql` are read; anything else in the directory is ignored.

## Reasoning
Node js ecosystem has many database migration tools, some are independent, some are parts of ORM libraries.
I needed a simple and minimalistic tool that can just apply migrations written as sql in `.sql` files, and have up and down migrations in a single file, to enable Copilot write down migrations for me :)
