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

const glob = new Glob("**/*.test.ts");
const files: string[] = [];
for await (const file of glob.scan({ cwd: "src" })) {
  files.push(`src/${file}`);
}
files.sort();

let passed = 0;
let failed = 0;
const failedFiles: string[] = [];

for (const file of files) {
  const proc = Bun.spawn(["bun", "test", "--no-coverage", file], {
    env: { ...process.env, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);
  const filePass = passMatch ? Number.parseInt(passMatch[1], 10) : 0;
  const fileFail = failMatch ? Number.parseInt(failMatch[1], 10) : 0;
  passed += filePass;
  failed += fileFail;

  if (exitCode !== 0) {
    failedFiles.push(file);
    console.log(`\n${file}`);
    console.log(output);
  } else {
    console.log(`${file} (${filePass} tests)`);
  }
}

console.log(`\n${passed} pass, ${failed} fail across ${files.length} files`);

if (failedFiles.length > 0) {
  console.log("\nFailed files:");
  for (const f of failedFiles) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}
