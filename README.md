<p align="center">
    <img src="./martlet.webp" alt="Martlet" width="100">
    <br />
    <em>Migrate your database schema in a simple manner.</em>
</p>

Martlet project provides a seamless way to manage database schema versions leveraging PostgreSQL (other databases will be added later). Through a CLI interface, users can execute up or down migrations. The software's core functionality lies in applying migrations in a transaction, handling database connections, and dynamically loading the database driver as needed.


## Installation

```bash
npm i -g martlet
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
martlet --help
```

### Commands

#### Up

```bash
martlet up --database-url postgres://user:password@localhost:5432/dbname
```

#### Down

```bash
martlet down 0 --database-url postgres://user:password@localhost:5432/dbname
```

## Reasoning
Node js ecosystem has many database migration tools, some are independent, some are parts of ORM libraries.
I needed a simple and minimalistic tool that can just apply migrations written as sql in `.sql` files, and have up and down migrations in a single file, to enable Copilot write down migrations for me :)
