/* biome-ignore-all lint/suspicious/noConsole: CLI script */
import { Glob } from "bun";

const migrate = Bun.spawn(["bun", "run", "src/server/database/cli.ts", "up"], {
  env: { ...process.env, NODE_ENV: "test" },
  stdout: "inherit",
  stderr: "inherit",
});
const migrateExit = await migrate.exited;
if (migrateExit !== 0) {
  console.error("Migration failed");
  process.exit(1);
}

// Both extensions: component tests live in .test.tsx, and a `**/*.test.ts`
// pattern does not match them.
const glob = new Glob("**/*.test.{ts,tsx}");
const files: string[] = [];
for await (const file of glob.scan({ cwd: "src" })) {
  files.push(`src/${file}`);
}
files.sort();

// Per-file timeout safety net: a hung file is killed, named, and counted as
// failed instead of stalling the whole job for minutes. Override via env.
const FILE_TIMEOUT_MS = Number.parseInt(
  process.env.TEST_FILE_TIMEOUT_MS ?? "60000",
  10,
);

let passed = 0;
let failed = 0;
const failedFiles: string[] = [];
const timings: { file: string; ms: number }[] = [];

for (const file of files) {
  const proc = Bun.spawn(["bun", "test", "--no-coverage", file], {
    // Pin the session cookie name: tests hardcode `session_id=`, so a custom
    // SESSION_COOKIE_NAME in a developer's .env must not leak in and break them.
    //
    // AUTH_MODE, CAPTCHA_ENABLED and TEAMS_ENABLED are pinned for the same
    // reason: all three are optional, all three change how the app behaves, and
    // all three end up in a developer's .env the moment they run the dev server
    // that way. Leaked in, they fail every test that posts to an auth form —
    // the captcha rejects an unsolved challenge, the magic-link tests find
    // themselves in password mode, and every `expect(404)` on a team route
    // stops holding. Files that exercise any of them set it themselves
    // per-case.
    //
    // PORT and APP_URL are pinned because a Conductor workspace runs its dev
    // server on its own allocated port. Tests hardcode `http://localhost:3000`
    // in request URLs and csrf.test.ts builds its expected Origin from
    // APP_URL — a workspace port leaking in makes the two disagree and 403s
    // every form post. DATABASE_URL is deliberately *not* pinned: that one is
    // per-workspace on purpose, so two agents' suites don't truncate the same
    // tables (see scripts/workspace.ts).
    env: {
      ...process.env,
      NODE_ENV: "test",
      SESSION_COOKIE_NAME: "session_id",
      AUTH_MODE: "magic-link",
      CAPTCHA_ENABLED: "false",
      TEAMS_ENABLED: "false",
      PORT: "3000",
      APP_URL: "http://localhost:3000",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, FILE_TIMEOUT_MS);

  const start = performance.now();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const ms = Math.round(performance.now() - start);
  timings.push({ file, ms });

  const output = stdout + stderr;
  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);
  const filePass = passMatch ? Number.parseInt(passMatch[1], 10) : 0;
  const fileFail = failMatch ? Number.parseInt(failMatch[1], 10) : 0;
  passed += filePass;
  failed += fileFail;

  if (timedOut) {
    failed += 1;
    failedFiles.push(file);
    console.log(
      `\n${file} — TIMED OUT after ${Math.round(FILE_TIMEOUT_MS / 1000)}s — killed`,
    );
  } else if (exitCode !== 0) {
    failedFiles.push(file);
    console.log(`\n${file}`);
    console.log(output);
  } else {
    console.log(`${file} (${filePass} tests, ${ms}ms)`);
  }
}

console.log(`\n${passed} pass, ${failed} fail across ${files.length} files`);

const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 10);
if (slowest.length > 0) {
  console.log("\nSlowest files:");
  for (const { file, ms } of slowest) {
    console.log(`  ${ms}ms  ${file}`);
  }
}

if (failedFiles.length > 0) {
  console.log("\nFailed files:");
  for (const f of failedFiles) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}
