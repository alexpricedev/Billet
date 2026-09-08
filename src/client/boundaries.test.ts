import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// The guardrails on client code, as a test rather than a paragraph. Billet's
// client has three tiers — plain forms with redirects, forms enhanced with a
// server-rendered fragment, and presentation over rows already on the page —
// and everything below is what stops a fourth tier appearing: a client that
// fetches JSON, builds its own markup, and holds domain state. See CLAUDE.md,
// "Client code has three tiers". Raise a budget or add an exemption only with
// the reason written next to it.

const CLIENT = "src/client";
const SERVER = "src/server";

// The one place the client talks to the server and parses what comes back.
const NETWORK_AND_MARKUP_ALLOWED = new Set([`${CLIENT}/reactive/request.ts`]);

// Minified bytes for the main entry point. It is 8.7 KB at the time of
// writing; a new component costs one or two. Going past this is a signal that
// something is being built on the client that belongs on the server.
const MAIN_BUNDLE_BUDGET_BYTES = 12_000;

const sources = (root: string): string[] =>
  Array.from(new Glob("**/*.{ts,tsx}").scanSync(root))
    .filter((file) => !file.includes(".test.") && !file.includes("test-utils"))
    .map((file) => `${root}/${file}`)
    .sort();

type Rule = { name: string; pattern: RegExp; why: string };

const FORBIDDEN_IN_CLIENT: Rule[] = [
  {
    name: "network",
    pattern: /\bfetch\(|XMLHttpRequest|new WebSocket|new EventSource/,
    why: "the client talks to the server through submitForm, and the server answers with HTML",
  },
  {
    name: "markup built on the client",
    pattern:
      /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|DOMParser|createElement\(\s*["']template["']/,
    why: "the server renders every piece of markup; the client inserts what it was sent",
  },
  {
    name: "JSON consumed by the page",
    pattern: /JSON\.parse\(/,
    why: "the JSON API is for machines; a page reading it is a client application",
  },
  {
    name: "client routing",
    pattern:
      /history\.(pushState|replaceState)|location\.(assign|replace)\(|location\.href\s*=/,
    why: "navigation is a link or a server redirect",
  },
  {
    name: "client storage",
    pattern: /localStorage|sessionStorage|indexedDB/,
    why: "state lives on the server; signals hold interface state for one page view",
  },
];

// One import statement per match: a line starting with `import`, up to the
// first semicolon — anchored to the line start so the word in a comment doesn't
// swallow the code after it. Type-only imports are erased and cross freely.
const importStatements = (source: string): string[] =>
  source.match(/^import\s[^;]*;/gm) ?? [];

const isTypeOnly = (statement: string): boolean =>
  /^import\s+type\b/.test(statement);

describe("client boundaries", () => {
  const clientFiles = sources(CLIENT);
  const serverFiles = sources(SERVER);

  test("client code has files to check", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  for (const rule of FORBIDDEN_IN_CLIENT) {
    test(`no ${rule.name} outside the request helper`, async () => {
      const offenders: string[] = [];
      for (const file of clientFiles) {
        if (NETWORK_AND_MARKUP_ALLOWED.has(file)) continue;
        const source = await Bun.file(file).text();
        const match = source.match(rule.pattern);
        if (match) offenders.push(`${file}: ${match[0]}`);
      }
      expect(offenders, `${rule.name} in client code — ${rule.why}`).toEqual(
        [],
      );
    });
  }

  test("client code imports nothing from the server at runtime", async () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const source = await Bun.file(file).text();
      for (const statement of importStatements(source)) {
        if (isTypeOnly(statement)) continue;
        if (/from\s+["'](@server\/|(\.\.\/)+server\/)/.test(statement)) {
          offenders.push(`${file}: ${statement.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("server code imports nothing from the client at runtime", async () => {
    // Types cross freely — that is how templates typecheck their binding
    // names. Runtime imports of client code would put DOM code in the server
    // process; `src/shared/` is where code both sides run belongs.
    const offenders: string[] = [];
    for (const file of serverFiles) {
      const source = await Bun.file(file).text();
      for (const statement of importStatements(source)) {
        if (isTypeOnly(statement)) continue;
        if (/from\s+["'](@client\/|(\.\.\/)+client\/)/.test(statement)) {
          offenders.push(`${file}: ${statement.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("shared code has no DOM or Node dependency", async () => {
    const offenders: string[] = [];
    for (const file of sources("src/shared")) {
      const source = await Bun.file(file).text();
      if (/\b(document|window|navigator)\b\./.test(source)) {
        offenders.push(`${file}: DOM access`);
      }
      for (const statement of importStatements(source)) {
        if (isTypeOnly(statement)) continue;
        if (/from\s+["'](node:|bun|@client\/|@server\/)/.test(statement)) {
          offenders.push(`${file}: ${statement.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the main bundle stays under its byte budget", async () => {
    // Built in memory with the same flags as `build:client`, so the number is
    // the one that ships. Nothing is written to dist/.
    const result = await Bun.build({
      entrypoints: [`${CLIENT}/main.ts`],
      minify: true,
      target: "browser",
    });
    expect(result.success).toBe(true);
    const main = result.outputs.find((output) => output.kind === "entry-point");
    expect(main).toBeDefined();
    expect(
      main?.size ?? Number.POSITIVE_INFINITY,
      "main.js is over budget — is this presentation over server-rendered rows, or a client application?",
    ).toBeLessThan(MAIN_BUNDLE_BUDGET_BYTES);
  });
});
