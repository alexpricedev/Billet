# Billet README vs. Reality: Gap Analysis

## Claims That Are Well-Delivered

| README Claim | Verdict |
|---|---|
| **Bun-powered** | Fully delivered. Bun runtime, Bun test runner, Bun bundler, Bun SQL driver. |
| **TypeScript-first** | Strong. Strict mode, path aliases, types flow from service to template. |
| **Server-side rendering** | Solid. `renderToReadableStream()` with a clean `render()` helper, deterministic templates. |
| **Separation of concerns** | Excellent. Service → Controller → Template layering is clean and consistent. |
| **Tailwind CSS** | Present and working with Tailwind 4. |

## Claims That Are Misleading or Undelivered

### ~~1. "HTML streaming: Powered by react-dom/server" — False~~ FIXED

~~The codebase uses `renderToString()`, which is synchronous and produces a complete HTML string. Streaming would use `renderToReadableStream()` (the web/Bun-compatible streaming API). This is the single most inaccurate claim in the README.~~

Switched to `renderToReadableStream()` — HTML is now genuinely streamed to the client. (`10523d1`)

### ~~2. "Familiar JSX/TSX templating... not tied to any framework" — Misleading~~ FIXED

~~The project depends on `react` and `react-dom` (v19.1.1) for JSX rendering. The JSX _is_ React JSX. It's not framework-agnostic — if React changes its JSX runtime, this project breaks. The claim would be honest as "React JSX used only server-side, with no client-side React."~~

Reworded to: "React JSX used purely as a server-side template engine — no client-side React, no virtual DOM, no hydration."

### ~~3. "Opt-in interactivity: Sprinkle in any client-side framework where you need it" — Unproven~~ FIXED

~~There's no example of opting in a client-side framework on a specific page. The page routing pattern (`data-page` → `init()`) could support it, but without a concrete example (e.g., mounting a React island or a Svelte component), this reads as a theoretical claim.~~

Added a Preact island on `/examples`: a live search filter mounted into server-rendered HTML, proving the opt-in interactivity pattern.

### ~~4. "Web components support: Use or author custom elements natively" — Thin~~ FIXED

~~There's a single `<my-paragraph>` web component. It's a minimal example, not a pattern you'd build on. There's no guidance on shadow DOM, slots, attribute handling, or how web components interact with the SSR story.~~

Replaced `<my-paragraph>` with a `<copy-button>` web component that demonstrates shadow DOM, scoped styles, `observedAttributes`, `attributeChangedCallback`, and Clipboard API interaction. Used on both `/about` and `/examples` pages.

### 5. "Easy deploy: Instantly deployable to Railway" — Incomplete

No `railway.json`, no `Dockerfile`, no `Procfile`. The deploy section is 4 bullet points that amount to "push and pray." There's no documentation of required environment variables (`DATABASE_URL`, `CRYPTO_PEPPER`, `APP_URL`), no mention that you need a PostgreSQL addon, and no migration step for production.

### 6. "Modern frontend tooling: Integrates with your favorite tools and workflows" — Vague

This claim says nothing specific. The actual tooling (Tailwind, Biome, Bun bundler) is good but the README doesn't name any of it in the features list.

## What the README Undersells

The README significantly undersells the project. These major features exist but aren't mentioned:

| Feature | What's Actually There |
|---|---|
| **Authentication** | Complete magic-link auth with session management, HMAC-protected tokens, 30-day sessions with renewal |
| **CSRF Protection** | Sophisticated synchronizer token pattern with rate limiting, timing-safe comparison, origin validation |
| **Database Layer** | PostgreSQL with a custom migration CLI (`migrate:up/down/status/create`), parameterized queries |
| **Test Infrastructure** | 15 test files, real DB testing for services, mock-based controller tests, factory functions, comprehensive test utils |
| **Security** | HMAC session IDs, HttpOnly/Secure/SameSite cookies, SQL injection prevention, XSS prevention via JSX escaping |
| **CLAUDE.md** | A thorough 200-line development guide purpose-built for AI agents — the best artifact in the repo for the stated mission |

---

## Recommendations

### A. Fix what's broken

1. ~~**Remove or deliver the HTML streaming claim.**~~ DONE — switched to `renderToReadableStream()` (`10523d1`)

2. ~~**Reframe the "not tied to any framework" claim.**~~ DONE — reworded to be honest about the React dependency.

3. **Add a real deployment guide.** Include:
   - A `railway.json` or `Dockerfile` with build/start commands
   - Required environment variables with descriptions
   - A note about PostgreSQL provisioning
   - A `bun run migrate:up` step for production

### B. Match the README to reality

4. **Document the auth system in the README.** This is a headline feature. A "What's Included" section should cover magic-link auth, session management, and CSRF protection — these are things developers spend days building.

5. **Document the database and migration system.** Show the migration CLI commands. This is a real differentiator from most starters.

6. **Document the testing story.** The "deterministic templates... test with confidence" tagline is the project's thesis. Back it up with a section showing how easy it is to test a controller without browser simulation.

7. **Replace vague features with specific ones.** Instead of "Modern frontend tooling" → "Biome linting with zero-warning enforcement." Instead of "Separation of concerns" → "Service → Controller → Template architecture with type safety across layers."

### C. Exceed expectations

8. **Add a "Build Your First Page" walkthrough.** The CLAUDE.md has a great "How Files Connect" section. A human-readable version in the README showing the 8-step flow for adding a page would make the starter far more approachable.

9. ~~**Add an opt-in framework example.**~~ DONE — Preact island on `/examples` proves framework opt-in; `<copy-button>` web component on `/about` and `/examples` proves native web component support with full lifecycle (shadow DOM, `observedAttributes`, `attributeChangedCallback`).

10. **Add a health check endpoint** (`/api/health`) that verifies DB connectivity. Essential for Railway/any container platform.

11. **Add environment variable validation at startup.** The server should fail fast with clear messages if `DATABASE_URL` or `CRYPTO_PEPPER` is missing, rather than crashing mid-request.

12. **Add structured logging.** The project bans `console` but provides no alternative. A lightweight logger (even a simple wrapper that writes to stderr with timestamps and levels) would fill this gap.

13. **Add cache headers for static assets.** The `fetch` handler serves files from `dist/assets/` and `public/` with no `Cache-Control` headers. Hashed filenames + long cache TTLs would be an easy performance win.

14. **Document the AI-agent story more prominently.** The "designed for AI agents" tagline is the unique selling point, but the README barely explains why. Pull the best ideas from CLAUDE.md into a visible section: deterministic templates, fast test feedback loops, strong types as agent context.

---

## Priority Order

If picking the highest-impact changes:

1. ~~**Fix the streaming claim**~~ DONE
2. **Add a "What's Included" section** — the project is undersold by 50%
3. **Add deployment docs with env vars** — table stakes for a starter
4. **Add the "Build Your First Page" walkthrough** — makes the starter actually usable
5. ~~**Deliver the opt-in interactivity example**~~ DONE — Preact island on `/examples`

The codebase itself is well-architected. The gap is almost entirely in the README not reflecting what's actually been built, plus a couple of claims that overreach.
