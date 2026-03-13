<p align="center">
  <img src="public/logo.svg" alt="Billet Logo" width="48" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>Full-stack TypeScript starter designed to be built on by AI coding agents</b>
  <br />
  Server-rendered JSX, light-touch JS, custom CSS — one codebase, one deploy target.<br />
  Deterministic templates with strong types that AI agents can reason about and test with confidence.
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals"><img src="https://img.shields.io/badge/JSX/TSX-20232a?style=for-the-badge&logo=javascript&logoColor=yellow" alt="JSX/TSX" /></a>
  <a href="https://typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://railway.com?referralCode=XB1wns"><img src="https://img.shields.io/badge/Deploy%20on-Railway-131415?style=for-the-badge&logo=railway&logoColor=white" alt="Railway" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

> **TLDR:** Full-stack TypeScript starter built for AI coding agents. Server-rendered JSX (not React), custom CSS, PostgreSQL via Bun — one process, one test runner, one deploy target. Ships with magic-link auth, CSRF protection, rate limiting, auto-migrations, and 30+ test files. The architecture is deliberately simple (services → controllers → templates) so AI agents get fast, unambiguous feedback from strict types, zero-warning linting, and a test suite that runs in seconds. Deploy anywhere you can run `bun run start`.
>
> — *Claude Opus 4.6*

<p align="center"><a href="https://github.com/alexpricedev/Billet?tab=readme-ov-file#quick-start"><b>Get started →</b></a></p>

---

## Why Billet?

> **Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. Named for Sheffield — the Steel City, where crucible steel was invented.

Left to their own choices, AI coding agents will reach for what they know best: React with Next.js. The result is a thick-frontend app split across client and server, locked into a specific ecosystem, requiring multiple test systems to simulate browser state, and unnecessarily complex and costly to deploy.

Billet takes the opposite approach. It's a single-instance server-rendered app with light-touch client-side JavaScript. Templates are deterministic functions of their props — given the same input, they produce the same HTML. This makes them trivial to test in a single unified system without browser simulation. One codebase, one test runner, one deploy target.

This isn't a limitation. It's a deliberate architectural choice that plays to AI's strengths: strong type information to reason about, functional input/output patterns, and a feedback loop (write code → run tests → see results) that works in seconds, not minutes.

### Capture your backpressure

AI agents work best when they get told they're wrong immediately. Not by you — by the toolchain. Type errors, failing tests, lint warnings, broken builds — that's [backpressure](https://latentpatterns.com/principles), and it's the single most important thing you can invest in when working with agents. Every automated check that catches a mistake is one less time you have to context-switch back in to fix something a machine should have caught.

When you do have to step in and rescue an agent, don't just fix the output and move on. Ask why it went wrong and close that gap. Add a type. Write a test. Tighten a schema. The goal isn't zero failures — it's zero repeat failures. Every rescue you engineer away is time you get back.

Billet is built around this idea: strict TypeScript, zero-warning linting, deterministic templates, and a test suite that runs in seconds. The architecture itself is the feedback loop.

### When Billet isn't the right fit

Billet is built for server-rendered apps with light client-side interactivity. If your project needs a highly reactive, state-driven UI — real-time collaborative editing, complex drag-and-drop interfaces, rich data visualisations — you're better off with a full client-side framework like React or Svelte from the start. Billet lets you opt in to client-side frameworks per page, but if most of your pages need one, the thin-frontend approach is working against you rather than for you.

---

## What's Included

Auth, security, database, testing, linting — these are the rails. They're solved so the agent can focus on your custom logic instead of bugging you with questions about tech choices and security fundamentals.

### Authentication

A complete magic-link email auth flow: users enter their email, receive a login link, and get a session. No passwords to store, hash, or reset.

- **Magic-link login** with HMAC-protected tokens and expiry
- **Session management** with 30-day sessions, automatic renewal, and secure cookie handling (HttpOnly, Secure, SameSite)
- **Guest sessions** that auto-create for unauthenticated visitors — useful for carts, preferences, or any state you want before login
- **Admin middleware** with role-based route protection and a dedicated `/admin` route namespace
- **Pluggable email providers** — ships with a console provider for development; add Resend or any custom provider via a simple interface

### Security

- **CSRF protection** using the synchronizer token pattern with timing-safe comparison and origin validation
- **Rate limiting** middleware with configurable sliding-window limits per IP
- **Session fixation prevention** — sessions are regenerated on login
- **Environment validation** at startup — the server fails fast with clear error messages if required variables are missing
- **Response hardening** with security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)

### Database

PostgreSQL through Bun's built-in `Bun.SQL` — no ORM, no driver dependency.

- **Auto-migrations on startup** — pending migrations run before the server accepts requests; if one fails, the server won't start
- **Migration CLI** for manual operations (`migrate:up`, `migrate:status`, `migrate:create`)
- **Seed script** scaffold for development data (`bun run seed`)
- **Parameterised queries** throughout — no string concatenation, no SQL injection surface

### Testing

The "deterministic templates, test with confidence" tagline isn't a marketing claim — it's backed by infrastructure.

- **220+ tests across 28 files** covering controllers, services, middleware, utilities, and client scripts
- **No browser simulation needed** — server-rendered templates are pure functions of props, testable with `renderToString()` and string assertions
- **Real database testing** for services — tests run against PostgreSQL with table truncation for isolation
- **Mock-based controller tests** that verify HTTP responses (status codes, headers, HTML content) without touching the database
- **Client script tests** using happy-dom for DOM globals, with page lifecycle isolation


Run the full suite: `bun run test`

### Code Quality

- **Biome** linting with zero-warning enforcement (`--max-warnings 0`) — no `any` types, no `console` statements, no unused variables
- **TypeScript** strict mode with `noUnusedLocals` and `noUnusedParameters`
- **Husky** pre-commit hooks that run lint and typecheck before every commit
- **Structured logging** via `src/server/services/logger.ts` — replaces `console.*` with levelled output (info, warn, error)

### Frontend

- **React JSX as a template engine** — server-side only, no client-side React, no virtual DOM, no hydration
- **Bun CSS bundler** with `@import` resolution, CSS nesting, and minification — no external CSS tooling needed
- **Opt-in interactivity** — sprinkle in any client-side framework per page (ships with a Preact island example loaded via CDN import map)
- **Page lifecycle system** — `registerPage()` / `PageController` pattern with `init()` and `cleanup()` for per-page JS
- **Cookie-based flash messages** — HMAC-signed, single-use cookies for post-redirect-get feedback (success banners, validation errors)
- **Asset cache-busting** in production — MD5-hashed filenames with immutable `Cache-Control` headers

---

## Built for AI Agents

The "designed for AI agents" tagline is the reason Billet exists, so here's what that means in practice.

### CLAUDE.md — the agent's guide

The repo includes a 200-line [`CLAUDE.md`](CLAUDE.md) that serves as an onboarding document for AI coding agents. It covers the full architecture: directory layout, naming conventions, routing patterns, service layer design, testing strategies by module type, and a step-by-step walkthrough for adding a new page. When an agent opens this project, it knows where everything goes and how everything connects — before writing a single line of code.

### Why this architecture works for agents

AI agents are good at following patterns with fast, unambiguous feedback. Billet is designed around that:

- **Deterministic templates.** Given the same props, a template produces the same HTML. Agents can write a template, call `renderToString()`, and assert on the output — no browser, no async rendering, no timing issues.
- **Strong types as context.** Types flow from service to controller to template. When an agent's code doesn't typecheck, it gets an error with a file path, line number, and expected type — enough to self-correct without human intervention.
- **Fast feedback loops.** `bun run test` completes in seconds. `bun run check` (lint + typecheck) catches issues before they compound. Agents can write-test-fix in tight cycles.
- **Separation of concerns.** Services own data, controllers orchestrate, templates render. Each layer is independently testable. An agent working on a controller doesn't need to understand the database schema — it works against typed service functions.
- **Zero-ambiguity conventions.** File naming, export patterns, route registration — everything follows documented conventions. There's one right way to add a page, one right way to add an API endpoint, and it's written down.

### The feedback stack

Every layer catches a different class of error before a human has to:

| Layer | What it catches |
|---|---|
| TypeScript strict mode | Type mismatches, missing properties, unused code |
| Biome linting | Style violations, unsafe patterns, console usage |
| Pre-commit hooks | Anything that slipped past the editor |
| Test suite | Behavioural regressions, broken templates, bad responses |


This is the [backpressure](#capture-your-backpressure) that keeps agents on the rails.

---

## Quick Start

You'll need [Bun](https://bun.sh) and a local [PostgreSQL](https://www.postgresql.org/) instance running. If you need help getting PostgreSQL set up, ask Claude — it'll walk you through the install for your OS.

Click **[Use this template](https://github.com/new?template_name=Billet&template_owner=alexpricedev)** on GitHub to create your own repo, then:

```bash
git clone <your-new-repo-url>
cd <your-project>
bun install
```

### First-time setup

Open [`START_PROMPT.md`](START_PROMPT.md) with your AI coding agent. It will walk through creating your `.env` files, renaming the project, stripping the Billet starter content, and verifying everything works.

Once setup is complete you can delete `START_PROMPT.md`.

### Manual setup

If you'd prefer to set up manually:

```bash
cp .env.example .env
bun run generate:pepper      # copy the output into CRYPTO_PEPPER in .env
```

Add your `DATABASE_URL` to `.env` (e.g. `postgresql://localhost/myapp`), then:

```bash
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000) — migrations run automatically on startup.

---

## Project Structure

```
src/
├── client/                     # Browser-side code
│   ├── main.ts                 # Entry point — routes to page controllers
│   ├── page-lifecycle.ts       # Page init/cleanup system
│   ├── style.css               # Global styles (CSS entry point)
│   ├── components/             # Shared CSS (nav, layout)
│   └── pages/                  # Page-specific JS + CSS (co-located)
│
├── server/                     # Server-side code
│   ├── main.ts                 # Server entry point
│   ├── routes/
│   │   ├── app.tsx             # View routes (HTML)
│   │   ├── api.ts              # API routes (JSON)
│   │   └── admin.tsx           # Admin routes (protected)
│   ├── controllers/            # Route handlers
│   │   ├── app/                # View controllers — return HTML
│   │   ├── api/                # API controllers — return JSON
│   │   └── auth/               # Auth controllers — login/logout
│   ├── templates/              # Full-page JSX templates
│   ├── components/             # Reusable server JSX components
│   ├── services/               # Business logic & data access
│   ├── middleware/             # Auth, CSRF, rate limiting, admin
│   ├── utils/                  # Response helpers, crypto, env validation
│   └── database/
│       ├── cli.ts / migrate.ts # Migration tooling
│       ├── seed.ts             # Development seed data
│       └── migrations/         # Numbered migration files
│
└── types/                      # Global TypeScript declarations
```

---

## Contributing

Contributions are welcome! Please open issues or PRs.

---

## Deploy

Billet is a single Bun process — no containers, no serverless adapters, no platform-specific runtime. Anywhere you can run `bun run start`, it'll work: Railway, Fly.io, Render, a VPS, or your own machine.

### Railway

A `railway.json` is included with build and start commands pre-configured. Deployments typically go live in under 60 seconds.

1. Push to GitHub
2. Create a new [Railway](https://railway.com?referralCode=XB1wns) project and connect your repo
3. Add a **PostgreSQL** plugin and link it to your service — this auto-sets `DATABASE_URL`
4. Set the remaining environment variables (see below)
5. Deploy — Railway will build, run migrations, and start the server

> **Tip:** If you're using Claude Code with the [Railway MCP server](https://docs.railway.com/guides/mcp), you can ask Claude to set up the project, add PostgreSQL, and configure environment variables for you.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string — auto-set when you link Railway's PostgreSQL plugin to your service |
| `CRYPTO_PEPPER` | Yes | Secret key for session tokens — run `bun run generate:pepper` to get one (see below) |
| `APP_URL` | Yes | Your app's public URL — you'll get this from Railway after your first deploy (e.g. `https://my-app.up.railway.app`) |
| `APP_ORIGIN` | No | Expected origin for CSRF validation — defaults to request host if not set |
| `PORT` | No | Server port — auto-set by Railway, defaults to `3000` locally |

> **Generating `CRYPTO_PEPPER`:** This is a secret key used to secure session tokens. Run `bun run generate:pepper` to get a value. Use a different value for each environment (development, production, etc).

### Database

Billet uses PostgreSQL through Bun's built-in `Bun.SQL` — no ORM, no driver dependency. Migrations run automatically on server startup — pending migrations are applied before the server accepts requests. If a migration fails, the server won't start (fail-safe).

A lightweight CLI is also available for manual operations:

```bash
bun run migrate:up       # Run pending migrations
bun run migrate:status   # Show migration state
bun run migrate:create   # Create a new migration file
```

If you don't need a database, remove the `src/server/database/` and `src/server/services/` directories and strip the DB-related routes. There's no framework coupling to undo.

---

## License

MIT — free for personal and commercial use.

---

<p align="center">
  <i>Made with ❤️ in Sheffield, UK</i>
</p>
