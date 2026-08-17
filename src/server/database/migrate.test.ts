import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "bun";
import type { PluginMigration } from "./plugin-migrations";

// The mocks have to be installed before the module under test is imported, so
// these sit below executable code on purpose — see CLAUDE.md.

type Applied = { id: string; name: string };

let applied: Applied[] = [];
let ran: string[] = [];

// One stable array identity for the lifetime of the file, mutated in place.
// `migrate.ts` binds to this export once at import time, so reassigning the
// variable would swap it out from under a reference it already holds.
const plugins: PluginMigration[] = [];

const setPlugins = (...migrations: PluginMigration[]): void => {
  plugins.length = 0;
  plugins.push(...migrations);
};

const fakeDb = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join("?");

  if (query.includes("CREATE TABLE IF NOT EXISTS migrations")) return [];
  if (query.includes("SELECT id, name, applied_at FROM migrations")) {
    return [...applied].sort((a, b) => a.id.localeCompare(b.id));
  }
  if (query.includes("SELECT id FROM migrations")) {
    // Mirrors `ORDER BY applied_at DESC` — `applied` is kept in insert order.
    return applied.length > 0 ? [applied[applied.length - 1]] : [];
  }
  if (query.includes("INSERT INTO migrations")) {
    applied.push({ id: values[0] as string, name: values[1] as string });
    return [];
  }
  if (query.includes("DELETE FROM migrations")) {
    applied = applied.filter((m) => m.id !== values[0]);
    return [];
  }
  return [];
}) as unknown as SQL;

mock.module("../services/database", () => ({ db: fakeDb }));
mock.module("./plugin-migrations", () => ({ pluginMigrations: plugins }));

const {
  getAllMigrationIds,
  getPendingMigrations,
  rollbackLastMigration,
  rollbackMigration,
  runMigration,
} = await import("./migrate");

const pluginMigration = (id: string, withDown = true): PluginMigration => ({
  id,
  name: id,
  up: async () => {
    ran.push(`up:${id}`);
  },
  ...(withDown
    ? {
        down: async () => {
          ran.push(`down:${id}`);
        },
      }
    : {}),
});

beforeEach(() => {
  applied = [];
  ran = [];
  setPlugins();
});

describe("getAllMigrationIds", () => {
  test("returns file migration ids without the .ts extension", () => {
    const ids = getAllMigrationIds();

    expect(ids).toContain("001_initial_setup");
    expect(ids.every((id) => !id.endsWith(".ts"))).toBe(true);
  });

  test("orders plugin migrations after every file migration", () => {
    setPlugins(pluginMigration("analytics_001_create_events"));

    const ids = getAllMigrationIds();
    const fileIds = ids.filter((id) => /^\d/.test(id));

    expect(ids[ids.length - 1]).toBe("analytics_001_create_events");
    expect(ids.indexOf("analytics_001_create_events")).toBeGreaterThan(
      ids.indexOf(fileIds[fileIds.length - 1]),
    );
  });

  test("preserves the order plugin migrations are registered in", () => {
    setPlugins(
      pluginMigration("analytics_001_create_events"),
      pluginMigration("analytics_002_add_index"),
    );

    expect(getAllMigrationIds().slice(-2)).toEqual([
      "analytics_001_create_events",
      "analytics_002_add_index",
    ]);
  });

  test("throws when two plugins claim the same id", () => {
    setPlugins(pluginMigration("dupe_001"), pluginMigration("dupe_001"));

    expect(() => getAllMigrationIds()).toThrow(/Duplicate migration id/);
  });

  test("throws when a plugin id collides with a migration file", () => {
    setPlugins(pluginMigration("001_initial_setup"));

    expect(() => getAllMigrationIds()).toThrow(/001_initial_setup/);
  });
});

describe("getPendingMigrations", () => {
  test("includes plugin migrations that have not run", async () => {
    setPlugins(pluginMigration("analytics_001_create_events"));

    expect(await getPendingMigrations()).toContain(
      "analytics_001_create_events",
    );
  });

  test("excludes plugin migrations already recorded as applied", async () => {
    setPlugins(pluginMigration("analytics_001_create_events"));
    applied = [
      {
        id: "analytics_001_create_events",
        name: "analytics_001_create_events",
      },
    ];

    expect(await getPendingMigrations()).not.toContain(
      "analytics_001_create_events",
    );
  });
});

describe("runMigration", () => {
  test("runs a plugin migration and records it as applied", async () => {
    setPlugins(pluginMigration("analytics_001_create_events"));

    await runMigration("analytics_001_create_events");

    expect(ran).toEqual(["up:analytics_001_create_events"]);
    expect(applied.map((m) => m.id)).toEqual(["analytics_001_create_events"]);
  });

  test("still resolves migrations from the migrations directory", async () => {
    await runMigration("001_initial_setup");

    expect(applied.map((m) => m.id)).toEqual(["001_initial_setup"]);
    // The numeric prefix is stripped for the human-readable name column.
    expect(applied[0].name).toBe("initial_setup");
  });
});

describe("rollbackMigration", () => {
  test("runs a plugin migration's down and clears the applied record", async () => {
    setPlugins(pluginMigration("analytics_001_create_events"));
    applied = [
      {
        id: "analytics_001_create_events",
        name: "analytics_001_create_events",
      },
    ];

    await rollbackMigration("analytics_001_create_events");

    expect(ran).toEqual(["down:analytics_001_create_events"]);
    expect(applied).toEqual([]);
  });

  test("throws when a plugin migration has no down, leaving it applied", async () => {
    setPlugins(pluginMigration("analytics_001_create_events", false));
    applied = [
      {
        id: "analytics_001_create_events",
        name: "analytics_001_create_events",
      },
    ];

    expect(rollbackMigration("analytics_001_create_events")).rejects.toThrow(
      /does not export a 'down' function/,
    );
    expect(applied).toHaveLength(1);
  });
});

describe("rollbackLastMigration", () => {
  test("rolls back the most recently applied migration, not the highest id", async () => {
    // A plugin id that sorts *before* the file ids it was applied after —
    // ordering by id would pick the wrong one here.
    setPlugins(pluginMigration("000_analytics_events"));
    applied = [
      { id: "001_initial_setup", name: "initial_setup" },
      { id: "000_analytics_events", name: "000_analytics_events" },
    ];

    await rollbackLastMigration();

    expect(ran).toEqual(["down:000_analytics_events"]);
    expect(applied.map((m) => m.id)).toEqual(["001_initial_setup"]);
  });

  test("is a no-op when nothing has been applied", async () => {
    await rollbackLastMigration();

    expect(ran).toEqual([]);
  });
});
