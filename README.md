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

## Why simple wins with AI

Modern web stacks are built for large teams with complex needs. SPAs, hydration, client state managers, server components, edge runtimes — layers of abstraction that exist to solve problems most apps don't have.

When you point an AI agent at that complexity, it struggles. Not because the AI is bad, but because the architecture is ambiguous. There are multiple valid places to put logic, multiple ways state can flow, and the AI has to guess which one you intended.

Billet takes the opposite approach. **Single-instance server. JSX templates. Props in, HTML out.** The entire rendering path is a pure function. There's nothing to guess.

---

## The thin front-end advantage

Server-side rendered templates are **deterministic and functional**. A template takes typed props and returns HTML. No client state to simulate. No hydration mismatches. No lifecycle hooks firing in unpredictable orders.

This matters for AI-driven development because:

**One test system, not two.** With an SPA, you need server tests *and* browser-based tests (Playwright, Cypress) to simulate client state, DOM interactions, and async rendering. With SSR templates, you test the same way you render — call a function, check the output. Your AI can write and run tests in a single environment without orchestrating browsers.

**Every state is simulatable.** Want to test what the page looks like when there are zero results? Pass an empty array. Error state? Pass an error prop. Loading state? There is no loading state — data is fetched before the template renders. You have **full control over every possible state** in a single test runner.

**No client/server boundary to cross.** In a typical SPA, the AI has to reason about data flowing through API calls, client-side fetch logic, state managers, and re-renders. Here, data flows in one direction: service → route → template → HTML. The AI can trace any feature from URL to rendered output in seconds.

**Inline styles and scripts stay co-located.** CSS and JS live next to the pages they belong to. No global stylesheet conflicts, no CSS-in-JS runtime, no tree-shaking mysteries. When your AI adds a page, everything that page needs goes in one obvious place.

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
