import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDatabase } from "../test-utils/database";
import { expectQueryToReject } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "../services/database";
import {
  getAppliedMigrations,
  rollbackMigration,
  runMigration,
  runMigrations,
  setMigrationsDirForTest,
} from "./migrate";

const PREFIX = "99990101";

let dir: string;
let counter = 0;

// Bun caches `import(path)`, so every fixture gets a path of its own.
const writeMigration = (id: string, body: { up: string; down?: string }) => {
  const sub = join(dir, `${counter++}`);
  mkdirSync(sub);
  writeFileSync(
    join(sub, `${id}.ts`),
    `export const up = async (db) => {\n${body.up}\n};\n${
      body.down ? `export const down = async (db) => {\n${body.down}\n};\n` : ""
    }`,
  );
  setMigrationsDirForTest(sub);
  return `${id}.ts`;
};

const tableExists = async (name: string): Promise<boolean> => {
  const rows = await db`SELECT to_regclass(${name}) AS found`;
  return rows[0].found !== null;
};

const fixtureRows = async () =>
  (await getAppliedMigrations()).filter((m) => m.id.startsWith(PREFIX));

const cleanFixtures = async () => {
  await db`DROP TABLE IF EXISTS tx_one, tx_two, tx_three`;
  await db`DELETE FROM migrations WHERE id LIKE ${`${PREFIX}%`}`;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "billet-migrate-"));
  await cleanFixtures();
});

afterEach(async () => {
  setMigrationsDirForTest(null);
  rmSync(dir, { recursive: true, force: true });
  await cleanFixtures();
});

describe("runMigration", () => {
  test("a failing migration leaves no table and no row, and rethrows", async () => {
    const file = writeMigration(`${PREFIX}000001_tx_broken`, {
      up: "await db`CREATE TABLE tx_one (id INTEGER)`;\nawait db`SELECT 1 / 0`;",
    });

    await expect(runMigration(file)).rejects.toThrow(/division by zero/);

    expect(await tableExists("tx_one")).toBe(false);
    expect(await fixtureRows()).toHaveLength(0);
  });

  test("running again after fixing it applies cleanly", async () => {
    const id = `${PREFIX}000001_tx_broken`;
    const broken = writeMigration(id, {
      up: "await db`CREATE TABLE tx_one (id INTEGER)`;\nawait db`SELECT 1 / 0`;",
    });
    await expect(runMigration(broken)).rejects.toThrow();

    const fixed = writeMigration(id, {
      up: "await db`CREATE TABLE tx_one (id INTEGER)`;",
    });
    await runMigration(fixed);

    expect(await tableExists("tx_one")).toBe(true);
    expect((await fixtureRows()).map((m) => m.id)).toEqual([id]);
  });
});

describe("runMigrations", () => {
  test("a failure in the second leaves the first applied and the third unrun", async () => {
    const sub = join(dir, "batch");
    mkdirSync(sub);
    const write = (id: string, up: string) =>
      writeFileSync(
        join(sub, `${id}.ts`),
        `export const up = async (db) => {\n${up}\n};\n`,
      );
    write(
      `${PREFIX}000001_tx_first`,
      "await db`CREATE TABLE tx_one (id INTEGER)`;",
    );
    write(
      `${PREFIX}000002_tx_second`,
      "await db`CREATE TABLE tx_two (id INTEGER)`;\nawait db`SELECT 1 / 0`;",
    );
    write(
      `${PREFIX}000003_tx_third`,
      "await db`CREATE TABLE tx_three (id INTEGER)`;",
    );
    setMigrationsDirForTest(sub);

    await expect(runMigrations()).rejects.toThrow(/division by zero/);

    expect(await tableExists("tx_one")).toBe(true);
    expect(await tableExists("tx_two")).toBe(false);
    expect(await tableExists("tx_three")).toBe(false);
    expect((await fixtureRows()).map((m) => m.id)).toEqual([
      `${PREFIX}000001_tx_first`,
    ]);
  });
});

describe("rollbackMigration", () => {
  test("a failing down leaves the migration recorded and its schema untouched", async () => {
    const id = `${PREFIX}000001_tx_down`;
    const file = writeMigration(id, {
      up: "await db`CREATE TABLE tx_one (id INTEGER)`;",
      down: "await db`DROP TABLE tx_one`;\nawait db`SELECT 1 / 0`;",
    });
    await runMigration(file);

    await expect(rollbackMigration(file)).rejects.toThrow(/division by zero/);

    expect(await tableExists("tx_one")).toBe(true);
    expect((await fixtureRows()).map((m) => m.id)).toEqual([id]);
  });

  test("a migration still gets the parameter guard inside the transaction", async () => {
    const file = writeMigration(`${PREFIX}000001_tx_guard`, {
      up: "const ids = ['a', 'b'];\nawait db`SELECT $" + "{ids}`;",
    });

    await expectQueryToReject(() => runMigration(file), /Unsafe SQL parameter/);

    expect(await fixtureRows()).toHaveLength(0);
  });
});
