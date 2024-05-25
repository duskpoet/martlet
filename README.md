<p align="center">
    <em>Migrate your database schema in a simple manner.</em>
</p>

## Overview

Martlet project provides a seamless way to manage database schema versions leveraging PostgreSQL (other databases will be added later). Through a CLI interface, users can execute up or down migrations. The software's core functionality lies in applying migrations in a transaction, handling database connections, and dynamically loading the database driver as needed.


### Installation
```bash
npm i -g martlet
```

```bash
yarn global add martlet
```

### Usage
```bash
martlet --help
```

### Commands

## Up

```bash
martlet up --database-url postgres://user:password@localhost:5432/dbname
```

## Down

```bash
martlet down 0 --database-url postgres://user:password@localhost:5432/dbname
```

