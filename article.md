# Coding exercise: database migration tool in nodejs

## Requirements
I want to have a database migration tool, that has the following properties:
1. Every migration is written in a single SQL file, meaning both "up" and "down" parts. This will allow Copilot to fill in the rollback migration. And the fact that it's a bare SQL also makes it the most flexible and supported solution.
2. Currently applied version should be managed by the tool. I want the tool to be self-sufficient.
3. I want the tool to support different databases like Postgres, MySQL, SQL Server, etc. So it should be extendable in that sense.
4. I don't want it to be oversized, so only drivers for the necessary database should be installed, ideally on demand.
5. I want it to be a part of javascript ecosystem, since most projects I write are a part of it.
6. Every migration should be performed inside of a transaction.


## Introduction
A lot of these points were born from my experience with this awesome tool, called [tern](https://github.com/JackC/tern). I was sad, that javascript doesn't have the same! So I decided this could be a nice coding exercise for myself and a story that could be interesting to someone else :)

## Development

### Part 1. Designing the tool
Let's ~~steal~~ design the protocol for this CLI tool! 
1. All migrations would have the following naming scheme: <number>_<name>.sql, like `001_initial_setup.sql` where number would represent the migration version number.
2. All migrations would reside in a single dir.
3. Database driver would be downloaded on demand, either some prebundled package or just issuing some sort of `npm install <driver>`.

So the syntax for the tool would be the following: `martlet up/down --database-url <url> --driver <driver> --dir <dir>`
Where options have the following meaning and defaults:
- **database-url** - connection string for the database, the default would be to lookup the env variable `DATABASE_URL`
- **driver** - database driver to use. For the first version I will only support postgres with option named "pg".
- **dir** - directory where migrations reside, default is `migrations`

