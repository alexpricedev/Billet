<!-- LOGO -->
<p align="center">
  <img src="public/logo.png" alt="Billet Logo" width="180" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>Full-stack TypeScript starter designed to be built on by AI coding agents</b>
  <br />
  Server-rendered JSX, light-touch JS, Tailwind CSS — one codebase, one deploy target.<br />
  Deterministic templates with strong types that AI agents can reason about and test with confidence.
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals"><img src="https://img.shields.io/badge/JSX/TSX-20232a?style=for-the-badge&logo=javascript&logoColor=yellow" alt="JSX/TSX" /></a>
  <a href="https://typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://railway.com?referralCode=XB1wns"><img src="https://img.shields.io/badge/Deploy%20on-Railway-131415?style=for-the-badge&logo=railway&logoColor=white" alt="Railway" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

---

## Why Billet?

> **Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. Named for Sheffield — the Steel City, where crucible steel was invented.

Left to their own choices, AI coding agents will reach for what they know best: React with Next.js. The result is a thick-frontend app split across client and server, locked into a specific ecosystem, requiring multiple test systems to simulate browser state, and unnecessarily complex and costly to deploy.

Billet takes the opposite approach. It's a single-instance server-rendered app with light-touch client-side JavaScript. Templates are deterministic functions of their props — given the same input, they produce the same HTML. This makes them trivial to test in a single unified system without browser simulation. One codebase, one test runner, one deploy target.

This isn't a limitation. It's a deliberate architectural choice that plays to AI's strengths: strong type information to reason about, functional input/output patterns, and a feedback loop (write code → run tests → see results) that works in seconds, not minutes.

### Capture your backpressure

The entire game now is to maximise the capture of your [backpressure](https://latentpatterns.com/principles) so agents stay on the rails. Backpressure is the automated feedback — type systems, test suites, linters, build errors, browser assertions — that tells an agent it went wrong before a human ever has to look. Without it, you become the bottleneck, manually catching trivial errors that a compiler or a test suite would have caught instantly.

If you have to go into the loop to rescue an agent, that is an anti-pattern. Don't just fix the output — ask why the agent went off the rails and engineer away that failure concern. Add a type constraint. Write a test. Tighten the schema. Every rescue mission you eliminate is capacity you reclaim for designing better loops. The goal is just enough backpressure to reject hallucinations and invalid output without creating so much resistance that the system grinds to a halt. Part art, part engineering, wholly non-negotiable.

Billet is built with this principle baked in: strict TypeScript, zero-warning linting, deterministic templates, and a fast test loop that agents can run in seconds. The architecture is the backpressure.

### When Billet isn't the right fit

Billet is built for server-rendered apps with light client-side interactivity. If your project needs a highly reactive, state-driven UI — real-time collaborative editing, complex drag-and-drop interfaces, rich data visualisations — you're better off with a full client-side framework like React or Svelte from the start. Billet lets you opt in to client-side frameworks per page, but if most of your pages need one, the thin-frontend approach is working against you rather than for you.

---

## 🚀 Features

- **Bun-powered**: Lightning-fast dev/build with Bun
- **Familiar JSX/TSX templating**: React JSX used purely as a server-side template engine — no client-side React, no virtual DOM, no hydration
- **Web standards first**: Embraces native HTML, CSS, and JavaScript
- **Separation of concerns**: Encourages clean, maintainable code structure
- **Strict code quality**: Biome linting with zero-warning enforcement, TypeScript strict mode, and Husky pre-commit hooks
- **Opt-in interactivity**: Sprinkle in any client-side framework where you need it
- **Server-side rendering**: TSX-based static/server components
- **HTML streaming**: Powered by `react-dom/server` in Bun
- **TypeScript-first**: Everything is written in TS and wired up by Bun
- **Easy deploy**: Instantly deployable to Railway

---

## 🏁 Quick Start

```bash
bun install
bun run dev
```

Then visit [http://localhost:3000](http://localhost:3000)

---

## 📁 Folder Structure

Billet just wants you to separate your backend logic and view creation (HTML) from your frontend code (style and interactivity). You can do what you like in terms of dir structure but here is the high level:

```
├── public/           # Static assets (logo, etc)
├── src/
│   ├── client/       # Frontend (component and page CSS + JS)
│   ├── server/       # Server routes, SSR templates using JSX (views)
│   └── types/        # Shared TypeScript types
├── dist/             # Build output
├── package.json      # Project metadata & scripts
└── README.md         # This file
```

---

## 🤝 Contributing

Contributions are welcome! Please open issues or PRs.

---

## ☁️ Deploy

Billet is a single Bun process — no containers, no serverless adapters, no platform-specific runtime. Anywhere you can run `bun run start`, it'll work: Railway, Fly.io, Render, a VPS, or your own machine.

### Railway

A `railway.json` is included with build and start commands pre-configured.

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

Billet uses PostgreSQL through Bun's built-in `Bun.SQL` — no ORM, no driver dependency. Migrations are managed with a lightweight CLI:

```bash
bun run migrate:up       # Run pending migrations
bun run migrate:status   # Show migration state
bun run migrate:create   # Create a new migration file
```

If you don't need a database, remove the `src/server/database/` and `src/server/services/` directories and strip the DB-related routes. There's no framework coupling to undo.

---

## 📄 License

MIT — free for personal and commercial use.

---

<p align="center">
  <i>Made with ❤️ in Sheffield, UK</i>
</p>
