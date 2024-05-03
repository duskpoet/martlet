import { it, before, after, describe } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { GenericContainer } from "testcontainers";

describe("Postgres adapter", async () => {
  let container;
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

  it("up", async () => {
    const port = container.getMappedPort(5432);
    const exit = await new Promise((resolve) => {
      const { stdout, stderr } = spawn("node", [
        "src/index.js",
        "up",
        "--driver",
        "pg",
        "--dir",
        "test/migrations",
        "--database-url",
        `postgres://postgres:password@localhost:${port}/postgres`,
      ]).addListener("exit", (code) => {
        resolve(code);
      });

      stdout.on("data", (data) => {
        console.log("OUT: ", data.toString());
      });
      stderr.on("data", (data) => {
        console.log("ERR: ", data.toString());
      });
    });
    if (exit) {
      console.error("Command failed, code:", exit);
      throw new Error("Command failed");
    }
    await import("postgres").then(async ({ default: pg }) => {
      const sql = pg(`postgres://postgres:password@localhost:${port}/postgres`);
      const result = await sql`select * from schema_migrations`;
      assert.deepEqual(result, [{ version: 2 }]);
      const tables =
        await sql`select table_name from information_schema.tables where table_schema = 'public'`;
      assert.deepEqual(tables, [
        { table_name: "schema_migrations" },
        { table_name: "test" },
      ]);
    });
  });

  it("down", async () => {
    const port = container.getMappedPort(5432);
    console.log("Starting down");
    const exit = await new Promise((resolve) => {
      const { stdout, stderr } = spawn("node", [
        "src/index.js",
        "down",
        "1",
        "--driver",
        "pg",
        "--dir",
        "test/migrations",
        "--database-url",
        `postgres://postgres:password@localhost:${port}/postgres`,
      ]).addListener("exit", (code) => {
        resolve(code);
      });

      stdout.on("data", (data) => {
        console.log("OUT: ", data.toString());
      });
      stderr.on("data", (data) => {
        console.log("ERR: ", data.toString());
      });
    });
    if (exit) {
      console.error("Command failed, code:", exit);
      throw new Error("Command failed");
    }

    await import("postgres").then(async ({ default: pg }) => {
      const sql = pg(`postgres://postgres:password@localhost:${port}/postgres`);
      const result = await sql`select * from schema_migrations`;
      assert.deepEqual(result, [{ version: 1 }]);
      const tables =
        await sql`select table_name from information_schema.tables where table_schema = 'public'`;
      assert.deepEqual(tables, [
        { table_name: "schema_migrations" },
        { table_name: "test" },
      ]);
    });
  });
});
