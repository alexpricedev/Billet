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

// Minified bytes for the main entry point. It is 9.1 KB at the time of
// writing, and an application component costs 1–2 KB — contact-directory and a
// two-part comment thread, built to test this layer, cost 1.6 KB and 2.2 KB.
//
// So the headroom is the number that matters, not the ceiling: 16 KB leaves
// room for roughly four more components before a deliberate decision is
// needed. It was 12 KB, which sounds generous and is three components, and the
// fourth tripped a failure message accusing code that was doing exactly what
// this layer is for. Raise it again only with the same arithmetic written
// down — the number moving is the signal that something is being built on the
// client that belongs on the server.
const MAIN_BUNDLE_BUDGET_BYTES = 16_000;

const sources = (root: string): string[] =>
  Array.from(new Glob("**/*.{ts,tsx}").scanSync(root))
    .filter((file) => !file.includes(".test.") && !file.includes("test-utils"))
    .map((file) => `${root}/${file}`)
    .sort();

type Rule = {
  name: string;
  pattern: RegExp;
  why: string;
  /** Files this rule does not apply to, each with its reason in a comment. */
  allow?: Set<string>;
};

const FORBIDDEN_IN_CLIENT: Rule[] = [
  {
    name: "network",
    pattern: /\bfetch\(|XMLHttpRequest|new WebSocket|new EventSource/,
    why: "the client talks to the server through server.submit, and the server answers with HTML",
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
    // The theme override is the one thing the server cannot hold: it belongs to
    // a browser, not an account, and there is no session for a signed-out
    // reader to put it in. It is also not domain data — with storage blocked
    // the page still renders correctly from `prefers-color-scheme`, it just
    // can't be overridden. Anything else reaching for storage is the fourth
    // tier this file exists to prevent.
    allow: new Set([`${CLIENT}/components/theme-toggle.ts`]),
  },
];

// One import statement per match: a line starting with `import`, up to the
// first semicolon — anchored to the line start so the word in a comment doesn't
// swallow the code after it. Type-only imports are erased and cross freely.
const importStatements = (source: string): string[] =>
  source.match(/^import\s[^;]*;/gm) ?? [];

const isTypeOnly = (statement: string): boolean =>
  /^import\s+type\b/.test(statement);

// The text before every `{` in a stylesheet, which is where a selector lives.
// A rule's prelude runs from the previous `{` or `}` to this one, so a nested
// rule inside a rule is read as its own selector.
const rulePreludes = (css: string): string[] => {
  const preludes: string[] = [];
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    if (css[index] === "{") {
      preludes.push(css.slice(start, index));
      start = index + 1;
    } else if (css[index] === "}") {
      start = index + 1;
    }
  }
  return preludes;
};

const withoutCommentsAndStrings = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"|'[^']*'/g, "");

// Everything inside parentheses at any depth: a pseudo-class argument, a media
// query. Excluded before the match because a select named there is a condition
// the rule is filtered by, not the element it styles — `:not(select)` styles
// everything that isn't one, and `@supports selector(select)` styles nothing.
const withoutParenthesised = (text: string): string => {
  let out = text;
  while (/\([^()]*\)/.test(out)) out = out.replace(/\([^()]*\)/g, " ");
  return out;
};

/**
 * Whether a stylesheet styles a `select` element. True when a compound
 * selector in some rule's prelude starts with the select element: `select`,
 * `.a select`, `select.foo`, `.a>select`. At-rule preludes are skipped
 * (`@keyframes select` names a keyframe, `@media` a condition), and so is
 * anything parenthesised. A `select` inside `:is()` is missed — deliberately:
 * the guard catches the page rule that re-pads a select, and the parenthesised
 * forms are how a false positive is written.
 */
const stylesSelect = (source: string): boolean =>
  rulePreludes(withoutCommentsAndStrings(source)).some((prelude) => {
    const preludeText = prelude.trimStart();
    if (preludeText.startsWith("@")) return false;
    return /(^|[\s,>+~])select(?![\w-])/.test(
      withoutParenthesised(preludeText),
    );
  });

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
        if (rule.allow?.has(file)) continue;
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

  test("style.css is a manifest and nothing else", async () => {
    // `@import` is hoisted above every other rule in a file, so a rule written
    // in style.css lands *after* every imported one and silently wins ties
    // against the pages and components it looks like it precedes. Keeping the
    // entry to imports is what makes the order on screen the cascade order.
    const source = await Bun.file(`${CLIENT}/style.css`).text();
    const offenders = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("@import "));
    expect(
      offenders,
      "style.css must hold only @import lines — put rules in base.css or a page/component file",
    ).toEqual([]);
  });

  test("select is styled once, in base.css", async () => {
    // Native selects size, pad and place their chevron differently in every
    // engine, so base.css draws one select from the control tokens. A page
    // rule that resizes or re-pads one select is how rows stop lining up and
    // forks collect a patch per page. A select that should fill its row gets a
    // class rule like `.role-picker { width: 100% }`, not `select.role-picker`.
    const offenders: string[] = [];
    for (const dir of ["components", "pages"]) {
      for (const file of new Glob("**/*.css").scanSync(`${CLIENT}/${dir}`)) {
        const path = `${CLIENT}/${dir}/${file}`;
        if (stylesSelect(await Bun.file(path).text())) offenders.push(path);
      }
    }
    expect(
      offenders,
      "style selects through the control tokens and the select rule in base.css, not per page",
    ).toEqual([]);
  });

  test("the select guard reads selectors, not the word", () => {
    // The guard above fails a fork's suite, so it has to be right about what
    // it is looking at in both directions: a rule that styles a select must be
    // caught wherever it is written, and a select named as a condition must
    // not be. `.form-field:has(select)` is the second direction in its common
    // form — it styles the container the select sits in, not the select — and
    // the guard accepts it on purpose. The two lists are those two directions,
    // one selector context per line.
    const styles: string[] = [
      "select { color: red; }",
      ".form-field select { color: red; }",
      "select.foo { color: red; }",
      "select[multiple] { color: red; }",
      "select:focus-visible { color: red; }",
      ".a,\nselect { color: red; }",
      ".a > select { color: red; }",
      ".a + select { color: red; }",
      ".a ~ select { color: red; }",
      ".a { select { color: red; } }",
      ".a { color: red }select { color: blue; }",
      "input, select, textarea { width: 100%; }",
      "select { width: 100%; }",
    ];
    const ignores: string[] = [
      ".a { user-select: none; }",
      ".a { -webkit-user-select: none; }",
      ".select { color: red; }",
      ".select-all { color: red; }",
      "#select { color: red; }",
      "::selection { background: red; }",
      ".a:not(select) { color: red; }",
      ".a:has(> select) { color: red; }",
      ".form-field:has(select) { color: red; }",
      "@supports selector(select) { .a { color: red; } }",
      "@keyframes select { from { opacity: 0; } }",
      "@media (width <= 640px) { .a { color: red; } }",
      '.a::before { content: "select {"; }',
      "/* select { color: red; } */",
    ];
    expect(
      styles.filter((css) => !stylesSelect(css)),
      "a rule that styles a select must be caught, wherever it is written",
    ).toEqual([]);
    expect(
      ignores.filter(stylesSelect),
      "only a rule that styles a select is an offence — a condition that names one is not",
    ).toEqual([]);
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
