#!/usr/bin/env bun

/**
 * Per-workspace database and port provisioning.
 *
 * Conductor gives every workspace its own git worktree, but the setup script
 * copies one `.env` into all of them — so every agent shares a dev database, a
 * test database, a port, and a session cookie name. The test database is the
 * dangerous one: `cleanupTestData` truncates every table, so two suites running
 * at once fail in ways neither agent can reproduce.
 *
 * `provision` rewrites this workspace's env files to point at resources named
 * after the workspace, creating the databases if they don't exist. `destroy`
 * drops them again. Both are wired into `.conductor/settings.toml`, and both
 * are safe to re-run — Conductor can re-run setup on an existing workspace.
 *
 * Cloud workspaces get neither: `CONDUCTOR_PORT` is unset there and the sandbox
 * has one checkout, so there is nothing to collide with.
 */

import { SQL } from "bun";

const DEV_ENV = ".env";
const TEST_ENV = ".env.test";

// ---------------------------------------------------------------------------
// Workspace identity
// ---------------------------------------------------------------------------

/**
 * A Postgres database name and a cookie name both end up carrying this, so it
 * is reduced to the characters that are unambiguous in each.
 */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const repoRoot = (): string => {
  if (process.env.CONDUCTOR_ROOT_PATH) return process.env.CONDUCTOR_ROOT_PATH;
  const proc = Bun.spawnSync(["git", "rev-parse", "--git-common-dir"]);
  if (proc.exitCode !== 0) {
    throw new Error("not a git repository, and CONDUCTOR_ROOT_PATH is unset");
  }
  return `${proc.stdout.toString().trim()}/..`;
};

// ---------------------------------------------------------------------------
// Env files
// ---------------------------------------------------------------------------

const readEnv = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `${path} not found — the Conductor setup script copies it from the repository root before this runs`,
    );
  }
  return file.text();
};

/** Read a variable out of env-file *text*, ignoring commented-out lines. */
const envValue = (text: string, key: string): string | undefined => {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1];
};

/**
 * Replace `key`'s value in place, keeping the comment that explains it. Only an
 * uncommented assignment is rewritten; if there is none the variable is
 * appended, so a fork that deleted the line still gets a working file.
 */
const setEnvValue = (text: string, key: string, value: string): string => {
  const line = new RegExp(`^${key}=.*$`, "m");
  if (line.test(text)) return text.replace(line, `${key}=${value}`);
  return `${text.replace(/\n*$/, "\n")}${key}=${value}\n`;
};

/** Swap the database name in a connection string, keeping credentials and host. */
const withDatabase = (connectionString: string, database: string): string => {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
};

const databaseName = (connectionString: string): string =>
  new URL(connectionString).pathname.replace(/^\//, "");

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/** `CREATE DATABASE` takes no parameters, so the name is quoted rather than bound. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** A connection to the maintenance database on the same server. */
const maintenance = (connectionString: string): SQL =>
  new SQL(withDatabase(connectionString, "postgres"), { max: 1 });

const createDatabase = async (admin: SQL, name: string): Promise<void> => {
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (existing.length > 0) {
    console.log(`  ${name} — already exists`);
    return;
  }
  await admin.unsafe(`CREATE DATABASE ${quoteIdent(name)}`);
  console.log(`  ${name} — created`);
};

const dropDatabase = async (admin: SQL, name: string): Promise<void> => {
  // FORCE terminates whatever is still connected. A dev server left running in
  // an archived workspace would otherwise hold the drop open indefinitely.
  await admin.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`,
  );
  console.log(`  ${name} — dropped`);
};

// ---------------------------------------------------------------------------
// provision
// ---------------------------------------------------------------------------

async function provision(): Promise<void> {
  const workspace = process.env.CONDUCTOR_WORKSPACE_NAME;
  const port = process.env.CONDUCTOR_PORT;

  if (!(workspace && port)) {
    console.log(
      "workspace: CONDUCTOR_WORKSPACE_NAME or CONDUCTOR_PORT is unset — leaving env files as copied.",
    );
    console.log(
      "workspace: expected in cloud workspaces, which have one checkout and nothing to collide with.",
    );
    return;
  }

  const slug = slugify(workspace);
  if (!slug) {
    throw new Error(
      `workspace name "${workspace}" has no usable characters for a database name`,
    );
  }

  // The root checkout's env files are the template. Deriving the base name from
  // *this* workspace's files instead would compound the suffix on a re-run.
  const root = repoRoot();
  const rootDev = await readEnv(`${root}/${DEV_ENV}`);
  const rootTest = await readEnv(`${root}/${TEST_ENV}`);

  const rootDevUrl = envValue(rootDev, "DATABASE_URL");
  const rootTestUrl = envValue(rootTest, "DATABASE_URL");
  if (!(rootDevUrl && rootTestUrl)) {
    throw new Error(
      `DATABASE_URL is missing from ${root}/${DEV_ENV} or ${root}/${TEST_ENV}`,
    );
  }

  const base = databaseName(rootDevUrl);
  const devDb = `${base}-${slug}`;
  const testDb = `${base}-${slug}-test`;

  let dev = await readEnv(DEV_ENV);
  dev = setEnvValue(dev, "DATABASE_URL", withDatabase(rootDevUrl, devDb));
  dev = setEnvValue(dev, "PORT", port);
  dev = setEnvValue(dev, "APP_URL", `http://localhost:${port}`);
  // Cookies are not scoped by port, so two workspaces on localhost overwrite
  // each other's session unless the name differs.
  dev = setEnvValue(
    dev,
    "SESSION_COOKIE_NAME",
    `${base}_${slug}_session`.replace(/-/g, "_"),
  );
  await Bun.write(DEV_ENV, dev);

  // DATABASE_URL is the only key .env.test carries, and the only one a
  // workspace changes: the rest of the suite's environment is pinned by
  // src/server/test-utils/test-env.ts. A workspace port must never reach the
  // tests — they hardcode `http://localhost:3000` in request URLs and
  // csrf.test.ts builds its Origin from APP_URL — and the pin is what
  // guarantees that whatever ends up in this file.
  let test = await readEnv(TEST_ENV);
  test = setEnvValue(test, "DATABASE_URL", withDatabase(rootTestUrl, testDb));
  await Bun.write(TEST_ENV, test);

  console.log(`workspace: provisioning "${workspace}" (slug ${slug})`);
  const admin = maintenance(rootDevUrl);
  try {
    await createDatabase(admin, devDb);
    await createDatabase(admin, testDb);
  } finally {
    await admin.end();
  }

  console.log(`  port ${port} — dev server, APP_URL http://localhost:${port}`);
  console.log(
    "  migrations and seed data are applied on first boot by main.ts",
  );
}

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

async function destroy(): Promise<void> {
  const workspace = process.env.CONDUCTOR_WORKSPACE_NAME;
  if (!workspace) {
    console.log(
      "workspace: CONDUCTOR_WORKSPACE_NAME is unset — nothing to tear down.",
    );
    return;
  }

  const slug = slugify(workspace);
  const dev = await readEnv(DEV_ENV);
  const test = await readEnv(TEST_ENV);
  const devUrl = envValue(dev, "DATABASE_URL");
  const testUrl = envValue(test, "DATABASE_URL");
  if (!(devUrl && testUrl)) {
    throw new Error(`DATABASE_URL is missing from ${DEV_ENV} or ${TEST_ENV}`);
  }

  // The guard, and the reason this is safe to wire into an archive hook: a name
  // is only dropped if it carries this workspace's slug. A workspace that was
  // never provisioned still points at the shared `billet` / `billet-test`, and
  // those fail the check rather than being dropped out from under every other
  // agent on the machine.
  const targets = [
    { name: databaseName(devUrl), expected: `-${slug}` },
    { name: databaseName(testUrl), expected: `-${slug}-test` },
  ];

  const owned = targets.filter(({ name, expected }) => {
    if (slug && name.endsWith(expected)) return true;
    console.log(`workspace: refusing to drop "${name}" — not owned by ${workspace}`);
    return false;
  });

  if (owned.length === 0) return;

  console.log(`workspace: tearing down "${workspace}"`);
  const admin = maintenance(devUrl);
  try {
    for (const { name } of owned) {
      await dropDatabase(admin, name);
    }
  } finally {
    await admin.end();
  }
}

// ---------------------------------------------------------------------------

const command = process.argv[2];

try {
  if (command === "provision") {
    await provision();
  } else if (command === "destroy") {
    await destroy();
  } else {
    console.error("Usage: bun run scripts/workspace.ts provision|destroy");
    process.exit(1);
  }
} catch (error) {
  console.error(
    `workspace: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
