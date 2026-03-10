<!-- LOGO -->
<p align="center">
  <img src="public/logo.png" alt="Billet Logo" width="180" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>The full-stack TypeScript starter that AI agents actually understand.</b>
  <br /><br />
  <i>In steelmaking, a billet is the semi-finished form — shaped, solid, and ready to become anything.<br />
  This is that, but for your next web app. You describe what you want. Your AI builds it.</i>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals"><img src="https://img.shields.io/badge/JSX_Templates-20232a?style=for-the-badge&logo=javascript&logoColor=yellow" alt="JSX Templates" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

---

## You describe it. Your AI builds it.

Billet is a full-stack TypeScript starter designed from the ground up for **vibe coding** — building web apps by describing what you want to an AI coding agent (Claude Code, Cursor, Copilot, Windsurf, or whatever you use).

Most starter templates are built for humans to read. Billet is built for **AI agents to read, understand, and extend correctly on the first try.**

**The problem:** You fire up a starter template, point your AI at it, and ask it to add a feature. The AI guesses at conventions, puts files in the wrong places, breaks patterns, and you spend more time fixing its work than you saved.

**Billet fixes this.** Every file follows a strict, documented pattern. Every convention is written down. The architecture is simple enough for an agent to hold in context, but complete enough to build real apps. Your AI doesn't guess — it knows.

---

## What makes it agent-friendly

**Documented patterns, not just code.** Billet ships with comprehensive agent context files (CLAUDE.md, .cursorrules, AGENTS.md) that tell your AI exactly how the codebase works — where files go, how they connect, and how to add more.

**Predictable architecture.** Server-side rendering with JSX templates, a clean service layer, typed data flow from route to template. No magic, no abstraction layers to decode. An agent can trace any request from URL to HTML in seconds.

**Strict conventions.** File naming, folder structure, route patterns — everything follows rules that are easy for an agent to learn and replicate. When your AI adds a new page, it knows exactly which files to create and where to put them.

**Strong types everywhere.** TypeScript strict mode with zero `any` types allowed. Your AI gets autocomplete-grade context about every function, prop, and return type. Fewer hallucinated interfaces, more working code.

**Built-in feedback loop.** Linting, type checking, and tests give your AI a way to verify its own work. It makes a change, runs the checks, and self-corrects if something's off.

---

## Quick start

```bash
bun install
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000) — then start vibing.

---

## Tell your AI to build something

Once the dev server is running, open your AI coding tool and try prompts like:

- *"Add a blog page that lists posts from a service"*
- *"Create an API endpoint that returns the current server time"*
- *"Add a dark mode toggle using a web component"*
- *"Build a dashboard page with visitor stats and charts"*

Your AI will read the agent context files, understand the patterns, and build it correctly.

---

## How it works

```
Request → Route → Service → Template → Response
                                ↓
                          Client JS/CSS
```

**Routes** handle requests and fetch data from **services**. Data flows into **JSX templates** that render server-side HTML. Each page can have co-located **client-side JS and CSS** for interactivity.

That's it. No framework magic. No build step mysteries. Just a clear path from request to response that any AI can follow.

---

## Project structure

```
src/
├── server/
│   ├── main.ts              # Bun server entry point
│   ├── routes/
│   │   ├── views.tsx         # Page routes (SSR → HTML)
│   │   └── api.ts            # API routes (→ JSON)
│   ├── services/
│   │   └── analytics.ts      # Business logic (shared across routes)
│   ├── templates/
│   │   ├── home.tsx          # Page templates (receive typed props)
│   │   ├── about.tsx
│   │   └── contact.tsx
│   └── components/
│       ├── layouts.tsx        # HTML document wrapper
│       └── nav.tsx            # Shared navigation
├── client/
│   ├── main.ts               # Client JS entry point
│   ├── style.css             # Global styles
│   ├── pages/                # Per-page JS and CSS
│   │   ├── home.ts + .css
│   │   ├── about.ts + .css
│   │   └── contact.ts + .css
│   └── components/           # Client component JS and CSS
└── types/                    # Shared TypeScript types
```

Every layer has one job. Every file has one place it belongs. Your AI never has to guess.

---

## The stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | [Bun](https://bun.sh) | Fast dev server, native TypeScript, built-in bundler |
| Language | TypeScript (strict) | Type safety from service to template |
| Templates | JSX/TSX | Familiar syntax, server-rendered (not React on the client) |
| Styling | Plain CSS | No build complexity, co-located with pages |
| Linting | [Biome](https://biomejs.dev) | Fast, zero-config, strict rules |
| Client JS | Vanilla TypeScript | Auto-mounted per page, no framework overhead |
| Web Components | Native custom elements | Encapsulated, framework-free interactivity |

JSX is used as a **templating language** for familiarity — this is not a React app. Templates render server-side to HTML. Client interactivity uses vanilla TypeScript and web components.

---

## Agent context files

Billet ships with context files for every major AI coding tool:

| File | Tool | Purpose |
|------|------|---------|
| `CLAUDE.md` | Claude Code | Full architecture docs, conventions, and how-to guides |
| `.cursorrules` | Cursor | Project rules and patterns for Cursor's AI |
| `AGENTS.md` | Any agent | Tool-agnostic project context |
| `.github/copilot-instructions.md` | GitHub Copilot | Copilot-specific project instructions |

These files are the secret sauce. They turn your AI from a generic code generator into a contributor that understands your project.

---

## Scripts

```bash
bun run dev        # Start dev server with hot reload
bun run build      # Production build
bun run check      # Lint + type check
bun run test       # Run tests
bun run validate   # Run everything (build + check + test)
```

---

## Deploy

Deploy anywhere that runs Bun. One-click deploy on [Railway](https://railway.com):

1. Push to GitHub
2. Create a new Railway project
3. Select your repo
4. Done

---

## Contributing

Contributions welcome! Open an issue or PR. This project uses strict linting — run `bun run check` before submitting.

---

## License

MIT — free for personal and commercial use.

---

<p align="center">
  <i>Forged in Sheffield, UK</i>
</p>
