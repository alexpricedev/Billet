<!-- LOGO -->
<p align="center">
  <img src="public/logo.png" alt="Billet Logo" width="180" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>An embarrassingly simple web stack.<br />That's the point.</b>
  <br /><br />
  <i>In steelmaking, a billet is the semi-finished form — shaped, solid, and ready to become anything.<br />
  This is that, but for your next web app.</i>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

---

## The default AI stack is the problem

Ask an AI to build you a web app from scratch. Nine times out of ten, it reaches for React and Next.js. Now you have a bifurcated application — a Node server *and* a React client, each with their own build pipeline, their own state management, their own testing strategy, and their own deployment target.

That's a lot of architecture for a todo app.

You're locked into the React ecosystem. You need browser-based testing tools (Playwright, Cypress) to verify what the client actually renders. You need separate server tests for your API layer. You're deploying to edge runtimes or serverless functions you didn't ask for. And your AI is reasoning across a client/server boundary where there are multiple valid places to put any piece of logic — so it guesses, and often guesses wrong.

**Billet sidesteps all of this.** Single-instance server. JSX templates. Props in, HTML out. One process, one test system, one deploy target. The entire rendering path is a pure function. There's nothing to guess.

---

## The thin front-end advantage

Server-side rendered templates are **deterministic and functional**. A template takes typed props and returns HTML. No client state to simulate. No hydration mismatches. No lifecycle hooks firing in unpredictable orders.

This changes everything about how effectively an AI can work with your code:

**One application, not two.** A React/Next.js app is really two applications bolted together — a server that provides data and a client that renders it. Each has its own state, its own failure modes, and its own testing requirements. Billet is one application. Data flows from service to route to template to HTML in a single process. There is no client/server split to reason across.

**One test system, not two.** Because templates are pure functions, you test them the same way you run them — call a function, check the output. No spinning up headless browsers. No Playwright scripts waiting for hydration. No flaky async assertions. Your AI writes a test, runs it in milliseconds, and knows immediately if the code works.

**Every state is simulatable from a single process.** Want to test what the page looks like with zero results? Pass an empty array. Error state? Pass an error prop. Loading state? There is no loading state — data is fetched before the template renders. You have **full control over every possible UI state** without orchestrating a browser.

**Deploy one process, not a distributed system.** No edge functions. No serverless cold starts. No CDN-hosted client bundles talking to a separate API. One Bun process serves everything. It's cheaper to run, simpler to debug, and trivial for an AI to reason about in production.

**Co-located styles and scripts.** CSS and JS live next to the pages they belong to. No global stylesheet conflicts, no CSS-in-JS runtime, no tree-shaking mysteries. When your AI adds a page, everything that page needs goes in one obvious place.

---

## How it works

```
Request → Route → Service → Template → HTML Response
```

That's the whole architecture. **Routes** handle requests. **Services** provide data. **Templates** are pure functions that take typed props and return markup. The response is fully rendered HTML.

Client-side JS is minimal and optional — a light touch for interactivity where it's actually needed, auto-mounted per page.

---

## Quick start

```bash
bun install
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000) — then start vibing.

---

## Project structure

```
src/
├── server/
│   ├── main.ts              # Bun server entry point
│   ├── routes/
│   │   ├── views.tsx         # Page routes (SSR → HTML)
│   │   └── api.ts            # API routes (→ JSON)
│   ├── services/             # Business logic (pure functions)
│   ├── templates/            # JSX templates (props → HTML)
│   └── components/           # Shared layout and nav
├── client/
│   ├── main.ts               # Client JS entry (auto-mounts per page)
│   ├── style.css             # Global styles
│   ├── pages/                # Per-page JS and CSS
│   └── components/           # Web components
└── types/                    # Shared TypeScript definitions
```

Every layer has one job. Every file has one place it belongs.

---

## The stack

| What | How | Why |
|------|-----|-----|
| Runtime | [Bun](https://bun.sh) | Fast, native TypeScript, built-in bundler — one tool |
| Templates | JSX/TSX | Server-rendered. Familiar syntax, not a React app |
| Styles | Plain CSS | Co-located per page. No build step, no runtime |
| Client JS | Vanilla TypeScript | Light touch. Auto-mounted, no framework |
| Types | TypeScript strict | Zero `any`. Types flow from service to template |
| Linting | [Biome](https://biomejs.dev) | Fast, strict, zero warnings allowed |

---

## Scripts

```bash
bun run dev        # Start dev server with hot reload
bun run build      # Production build
bun run check      # Lint with Biome
```

---

## Deploy

Runs anywhere Bun runs. Single process, no build orchestration.

---

## License

MIT

---

<p align="center">
  <i>Forged in Sheffield, UK</i>
</p>
