# Headless

How to fork Billet into a JSON API behind a React single-page frontend, keeping the
auth, teams, email and test layers and deleting the server-rendered one.

**Nothing in this runbook is implemented.** It is a recipe, written against the files as
they stand, for a fork that wants the back half of Billet and its own frontend. Core
Billet stays server-rendered; if you are reading this to understand shipped behaviour,
you want `.claude/rules/client.md` instead.

The motivating case: a designer prototypes pages in a tool that emits React (Lovable,
v0, Bolt), and those components are imported like-for-like rather than translated into
Preact templates. That rules out keeping Billet's three-tier client layer, so this
recipe deletes it rather than fighting it.

---

## 1. The decision that gates everything

**Cookie sessions, SPA served same-origin.** Not bearer tokens. The reasoning, so a
later reader does not re-run the argument:

`src/server/services/sessions.ts:28` already sets `httpOnly: true`, `secure` in
production, `sameSite: "lax"`, 30-day `maxAge`. The `sessions` table (migration `001`)
keys on `id_hash`, so session IDs are hashed at rest, with rolling expiry via
`renewSession` and revocation by deleting the row. That is a complete server-side
session store.

A bearer-token scheme has to rebuild all of it to get revocation back — a token table,
refresh rotation, expiry — and then stores the credential somewhere JavaScript can read
it. For a React SPA that is the trade that matters: `httpOnly` means an XSS bug lets an
attacker *ride* a session from the victim's browser; `localStorage` means it lets them
*take* the session and replay it anywhere, after the tab is closed.

The cost of cookies is that the SPA must be same-origin, and that writes need an Origin
check. Both are cheap. Serving the bundle from the same `Bun.serve` that answers `/api`
also means no CORS layer exists at all, which is one fewer thing to get wrong.

**Keep `sameSite: "lax"`. Do not "harden" it to `strict`.** Strict withholds the cookie
on cross-site navigation, so a user clicking a magic link in their email arrives signed
out, on a page whose whole job is to sign them in. Lax plus the Origin check in §3 is
the correct pairing, and `strict` is the kind of change that looks like an improvement
in review and is caught by nothing in the suite.

### The upgrade path stays open

Because a session is already an opaque hashed ID in a table, adding bearer tokens later
is the same lookup with a different transport: read the credential from `Authorization`
instead of `req.cookies`, keep `getSessionContextFromDB` and revocation untouched. Do
that when a native client or a third-party API consumer actually exists — not in
advance.

---

## 2. Inventory

### Keep, unchanged

| Area | Why it is the reason to fork rather than start over |
|---|---|
| `src/server/services/` | auth, sessions, users, organizations, invites, email + providers, passwords, captcha, cleanup, logger, database |
| `src/server/database/` | migrations, the guarded `db` proxy, `utils/sql.ts` helpers |
| `src/server/test-utils/` | `testDatabase()` pool cap, per-worker DB isolation, the env preload, `run-tests.ts` |
| `src/server/controllers/api/request-guard.ts` | `readJsonBody`, `readIdParam`, `readPagination`, `readStringField`, `apiReadLimit`, `apiWriteLimit` |
| `src/server/utils/response.ts` | `jsonError` and its one `{ error: { code, message } }` envelope |
| `src/server/utils/route-handler.ts` | `createApiRouteHandler` — method dispatch, JSON 405, `Allow` |
| `src/server/main.ts` | the boot order: `validateEnv` → migrations → seed → `initAssets` → serve |
| `src/server/utils/security-headers.ts` | `secureRoutes` / `handleGuarded`, minus the HTML error pages |

### Delete

`src/server/templates/`, `src/client/` in full (including `boundaries.test.ts` and every
stylesheet), `src/server/routes/app.tsx`, the flash-cookie layer,
`src/server/utils/form-action.ts`, `src/server/utils/csrf-tokens.ts`,
`src/server/services/seo.ts`, and the sitemap / `robots.txt` / webmanifest / `llms.txt`
controllers. Roughly 4,000 lines.

Deleting `src/client/` deletes `boundaries.test.ts`, which is the fence around the
three-tier rule. That is the intended loss — the whole point of this fork is a client
application — but it means **CLAUDE.md's "Client code has three tiers" section and
`.claude/rules/client.md` no longer describe the project.** Delete them in the same
commit. A rule file that survives the layer it governs is worse than no rule file: it
sends every future agent down a path the code no longer supports.

### Port, do not delete

The app auth controllers (`src/server/controllers/auth/`) answer with redirects and
flash state, so they cannot be reused — but the logic inside them is the fiddly part of
this codebase and must be carried across, not reimplemented:

- Magic-link issuance and the **GET renders a confirm step, POST spends the token** rule.
  Mail scanners fetch every link they deliver; a `GET` that redeemed would burn the token
  before the recipient clicked. `runbooks/EMAIL.md` has the full reasoning and it does not
  change in a headless fork — the confirm step becomes a page in the SPA, and the POST it
  makes is the redemption.
- `readPassword` from `controllers/auth/form-guard.ts`. Under JSON this matters less —
  `readFormValues`' trimming is what it exists to avoid — but the rule it encodes
  (whitespace is part of a password, never normalise one) applies to `readJsonBody` output
  just as hard.
- The `AUTH_MODE` branch. `magic-link` and `password` stay mutually exclusive; the
  endpoints for the wrong mode return `jsonError(404, ...)` where the HTML ones called
  `render404()`.

---

## 3. Phase one — the API auth layer

`/api` currently has **no authentication at all**. `todosApi` is rate-limited and
body-validated but entirely unauthenticated; it is a reference CRUD endpoint, not a
protected surface. There is no `requireAuth`, no `getSessionContext` and no CSRF check
anywhere under `src/server/controllers/api/`. Session auth exists and works — it has
simply never been wired to the JSON layer. This phase is that wiring, and it is the bulk
of the new code.

`requireAuth` in `src/server/middleware/auth.ts:65` returns a 303 to `/login`, which is
useless to a fetch. Write a sibling rather than changing it, in the discriminated-union
shape `requireOrgRole` already uses in `middleware/org.ts` — the caller gets the resolved
context, not just permission to continue:

```ts
// src/server/middleware/api-auth.ts
import type { BunRequest } from "bun";
import { validateOrigin } from "../services/csrf";
import type { SessionContext } from "../services/sessions";
import { jsonError } from "../utils/response";
import { getSessionContext } from "./auth";

export type ApiAuth = { ok: true; ctx: SessionContext } | { ok: false; response: Response };

export const requireApiAuth = async (req: BunRequest): Promise<ApiAuth> => {
  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated) {
    return {
      ok: false,
      response: jsonError(401, "unauthenticated", "Sign in to use this endpoint."),
    };
  }

  return { ok: true, ctx };
};

// Lax cookies are not sent on a cross-site POST, so this is belt to that brace: it
// also covers same-site-but-different-subdomain, which Lax does allow through.
export const requireSameOrigin = (req: BunRequest): Response | null =>
  validateOrigin(req)
    ? null
    : jsonError(403, "bad_origin", "Request origin is not allowed.");
```

`validateOrigin` (`src/server/services/csrf.ts:259`) compares `Origin`, falls back to
`Referer`, and **rejects when neither is present**. That is the right default and it is
why the double-submit token half of `middleware/csrf.ts` is not needed here: the token
existed to protect HTML forms, and a JSON API with Lax cookies plus Origin validation is
the standard modern equivalent.

Every mutating API controller then opens with four moves instead of three:

```ts
async create(req: BunRequest): Promise<Response> {
  const limited = apiWriteLimit(req);
  if (limited) return limited;

  const origin = requireSameOrigin(req);
  if (origin) return origin;

  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  // ... auth.ctx.user is non-null from here
}
```

Order matters and is not arbitrary: rate limit first so an attacker cannot use auth
failures to probe, Origin before auth so a cross-site request never touches the session
table, body last so nothing unvalidated reaches a service.

> **`APP_URL` must include the port.** `validateOrigin` builds the expected origin from
> it, so `http://localhost` against a server on `:3000` rejects every write with a 403.
> Same trap as the HTML CSRF check, same fix.

### The fence this phase needs

`boundaries.test.ts` is going away and this is what should replace it, in the same
`Rule[]` shape: **a test that fails the suite if any handler in `routes/api.ts` is
reachable without `requireApiAuth`**, with an explicit allowlist for the endpoints meant
to be public. Without it, the next endpoint someone adds inherits `todosApi`'s current
posture — open — and nothing says so. Write it in the same commit as the middleware, not
after.

---

## 4. Phase two — auth endpoints as JSON

The SPA needs endpoints that set and clear the cookie. These are new controllers under
`src/server/controllers/api/auth.ts`, using the services directly:

| Endpoint | Does |
|---|---|
| `POST /api/auth/login` | magic-link mode: issue and email the link, answer `202` with no body. password mode: verify, `setSessionCookie`, answer the user |
| `POST /api/auth/verify` | spend a magic-link token, `setSessionCookie`, answer the user. **Not** Origin-checked — see below |
| `POST /api/auth/logout` | revoke the session row, `clearSessionCookie` |
| `GET /api/auth/me` | the current `SessionContext`, or `401`. The SPA's boot call |

Two things to get right:

**`/api/auth/verify` cannot be Origin-checked**, for the same reason `/auth/verify` is
not today: the user arrives from their mail client, and the request that spends the token
originates from a page the SPA renders after a cross-site navigation. It is protected by
the token being single-use and short-lived, not by the origin. `runbooks/EMAIL.md` has
the full argument; do not "fix" this one either.

**`/api/auth/me` is what replaces server-rendered session awareness.** Every page in
Billet today knows who you are because the server rendered it. An SPA does not, so it
calls this once on boot and holds the answer. Two consequences worth writing down: the
response must be `Cache-Control: no-store`, and a `401` from any other endpoint means the
SPA re-calls it rather than assuming its cached copy is still true — sessions are revoked
server-side and the SPA is the last to know.

---

## 5. Phase three — serving React same-origin

`main.ts` already builds a `routes` map. Drop `appRoutes`, add the HTML entry point.
Bun's `routes` option takes an imported `.html` file directly: in development it bundles
on demand with HMR under `bun --hot`, and `bun build --target=bun` resolves the import to
a prebuilt manifest that `Bun.serve` ships with no runtime bundling.

```ts
import index from "../../app/index.html";

const server = Bun.serve({
  port: Number(process.env.PORT),
  routes: secureRoutes({
    ...apiRoutes,
    ...adminRoutes,
    "/*": index,     // SPA catch-all, last
  }),
  // ...
});
```

Four things this changes:

1. **CSP needs nothing.** The script allowlist is already `'self' 'unsafe-inline'` and
   the bundle is same-origin. A third-party script still needs its own CSP entry, an SRI
   hash and ideally a `preconnect` — unchanged from core.
2. **`handleFallback` and `BUNDLE_FILENAMES` stop applying.** Billet's dev-bundle 503
   logic (`serveDevBundle`) exists because `bun build --watch` rewrites `dist/assets/*` in
   place and a reload can read a file mid-write. Bun's HTML-import pipeline owns that
   problem instead. Delete `warnOnMissingDevBundles`, and with it the `setAssetsDirForTest`
   machinery — but read the note in CLAUDE.md about why that override exists before
   assuming nothing else needs it.
3. **The SPA catch-all must be registered last** and must not swallow `/api`. Bun matches
   specific routes before `/*`, so this works — but it also means a typo'd API path returns
   the SPA's HTML with a 200 instead of a 404, which is a confusing failure to debug from
   the client side. Worth an explicit `"/api/*"` route returning `jsonError(404, ...)` ahead
   of the catch-all.
4. **`render500()` returns HTML.** `handleGuarded` catches everything and answers with the
   styled error page whatever the route was — which is the bug `request-guard.ts` exists to
   prevent, now reintroduced at the pipeline level. Make `handleGuarded` branch on the path
   prefix and answer `/api/*` with `jsonError(500, ...)`.

---

## 6. What breaks quietly

Ordered by how long it takes to work out what happened.

1. **`X-Robots-Tag: noindex` is on by default.** `indexingAllowed()` is true only when
   `ALLOW_INDEXING=true`. You are deleting `services/seo.ts`, so the meta tag goes — but the
   header is set in `security-headers.ts` and stays. An SPA that is supposed to be indexed
   and silently is not is a long afternoon. `runbooks/SEO.md` §1b.
2. **Deleting `src/client/` orphans the test runner's assumptions.** `run-tests.ts` sweeps
   `TEST_PATHS = ["src"]`. The React app's own tests live
   outside that unless you name them, and a path inside a dot-directory needs the leading
   `./` or `bun test` reads the bare argument as a name filter.
3. **`rate-limit.ts`'s `requestLog` Map is module-level** and shared by every test file in a
   process. Any test file exercising a rate-limited API route calls `clearRateLimitLog()` in
   `beforeEach`, or it passes alone and fails after any file that drove the limiter to 429.
   Unchanged from core, easy to forget in new API test files.
4. **Guest sessions are created as a side effect.** `getSessionContext` writes a session row
   for an unauthenticated caller. An SPA polling `/api/auth/me` while signed out writes one
   row per poll. `cleanupSweep` reaps them, but check the arithmetic against your poll
   interval before shipping — or have `requireApiAuth` read the cookie and skip
   `getSessionContext` entirely when there isn't one.
5. **Two role axes still must not merge.** `users.role` is the platform operator flag;
   `organization_members.org_role` is standing inside one organisation. A JSON API makes it
   easier to conflate them than a form did, because there is no `org_role`-vs-`role` field
   naming convention to protect you. Every `:id` in a team endpoint stays scoped
   `WHERE user_id = $1 AND organization_id = $2`. `runbooks/TEAMS.md`.

---

## 7. Verification

In order. Each step is meant to fail loudly if the one before it was wrong.

1. `bun run check` — lint and typecheck. `noConsole: error` still applies; use `log` from
   `services/logger.ts`.
2. `bun run test` — through the script, never `bun test` directly. The script applies
   migrations and sets `NODE_ENV=test`; invoking the runner directly tests against whatever
   schema happens to be there.
3. **`curl` the API unauthenticated.** Every protected endpoint returns `401` with a JSON
   envelope, not a 303 and not an HTML page. This is the single check that catches the most
   likely failure of phase one.
4. **`curl` a write with no `Origin` header.** Expect `403`. If it succeeds, `validateOrigin`
   is not wired in.
5. **Revoke a session server-side while the SPA is open.** Expect the next call to 401 and
   the SPA to return to signed-out, not to hang on stale state.
6. Browser check with the `/browse` skill. Anything gated by CSS, layout, or a real engine is
   invisible to `bun run test`.

Use `scripts/qa-session.ts` to mint the cookie for steps 3–5 rather than reading one out of a
browser. The dev database is shared with whoever has the browser open, and
`DELETE FROM sessions` without a `user_id` predicate signs the developer out mid-session with
nothing on screen to explain it.

---

## 8. The prototype loop

Once this exists, the working arrangement is:

1. The designer prototypes in the React tool, in **its own repository**. Let it use whatever
   backend it provisions for itself — that data is throwaway and fighting it costs more than
   ignoring it.
2. Seed that tool's context with the design tokens from the app's stylesheet so prototypes
   come out in the real visual language and the import is structural only.
3. Components are imported like-for-like into `app/`; the data layer is rewritten against
   `/api`. The prototype's own hooks are never ported.
4. The prototype repo and this one never merge. A PR here cites the prototype commit SHA in
   its description, and that is the entire integration.

The one thing to establish before the first prototype rather than after: the API is the
contract. Generate an OpenAPI description of `/api` and give it to the prototyping tool —
it is the single highest-leverage input, and it is what stops a prototype promising a shape
the backend will not serve.
