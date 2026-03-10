# Planned Issues: Billet — The AI-Agent-Friendly Web Starter

These issues outline the transformation of SpeedLoaf into **Billet** — a full-stack TypeScript web starter specifically designed to be built on by AI coding agents.

> **Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. Just like a steel billet is the starting form that gets forged into a final product, Billet is the starting codebase that AI agents shape into your application.

---

## Issue 1: Rebrand SpeedLoaf to Billet

**Labels:** `branding`, `documentation`, `high-priority`

### Summary

Rebrand from SpeedLoaf to **Billet** and reposition as a full-stack TypeScript starter **specifically designed to be built on by AI coding agents** (Claude Code, Cursor, Copilot, Windsurf, etc.).

### Tasks

- [x] Choose a new name — **Billet**
- [ ] Design/source a new logo (steel billet / ingot motif)
- [ ] Update `package.json` name, description, and metadata
- [ ] Rewrite `README.md` with new positioning, features, and getting started guide
- [ ] Highlight what makes it agent-friendly: clear architecture, strong types, comprehensive project docs, documented patterns, test infrastructure
- [ ] Rename all references from "SpeedLoaf" to "Billet" throughout the codebase
- [ ] Update the GitHub repo name and description
- [ ] Secure `billet.dev` domain (if available)

### Context

The target audience is developers who use AI coding tools to build full-stack web apps. The name "Billet" comes from steelmaking — a billet is the semi-finished starting form of steel, ready to be shaped into something specific. Sheffield connection: the Steel City, where crucible steel was invented.

---

## Issue 2: Expand CLAUDE.md into comprehensive agent context docs

**Labels:** `documentation`, `dx`, `high-priority`

### Summary

Expand CLAUDE.md and add equivalent config files for other AI coding tools so that any agent gets full project context immediately.

### Tasks

- [ ] Expand `CLAUDE.md` with detailed architecture docs, step-by-step guides for common tasks (add a page, add a route, add a service), and naming conventions
- [ ] Add `.cursorrules` for Cursor users
- [ ] Add `AGENTS.md` as a tool-agnostic agent context file
- [ ] Add `copilot-instructions.md` (in `.github/`) for Copilot users
- [ ] Document all available commands (build, lint, test, format, dev)
- [ ] Document common pitfalls and constraints
- [ ] Include "how to extend" instructions: adding a new page end-to-end, adding an API endpoint, adding a service

### Why

The agent context file is the single most impactful thing for AI-assisted development. A great CLAUDE.md (or equivalent) means agents produce correct, consistent code on the first try instead of guessing at conventions.

---

## Issue 3: Add test infrastructure with example tests

**Labels:** `testing`, `infrastructure`, `high-priority`

### Summary

Add a test framework with example tests so AI agents can verify their changes work. Without tests, agents are flying blind.

### Tasks

- [ ] Set up `bun:test` as the test runner
- [ ] Add unit tests for existing services (e.g. `analytics.ts`)
- [ ] Add integration tests for API routes (test JSON responses)
- [ ] Add rendering tests for view routes (test HTML output contains expected content)
- [ ] Add a `bun run test` script to `package.json`
- [ ] Document testing patterns and conventions in agent context docs
- [ ] Ensure test files follow a predictable naming convention (e.g. `*.test.ts` co-located with source)

### Why

Agents need a feedback loop. Tests let an agent make a change, run tests, and confirm it works — or catch mistakes and self-correct. This is table stakes for agent-friendly development.

---

## Issue 4: Add thorough inline documentation to example code

**Labels:** `documentation`, `dx`

### Summary

Annotate existing example pages, routes, services, and components with clear comments that explain **the pattern being used and how to replicate it**. These serve as templates for AI agents to follow.

### Tasks

- [ ] Add pattern documentation comments to view routes (`views.tsx`) explaining the SSR flow
- [ ] Add pattern comments to API routes (`api.ts`) explaining the JSON response pattern
- [ ] Document the service layer pattern in `analytics.ts` with comments on how to create new services
- [ ] Annotate template files (`home.tsx`, etc.) explaining how props flow from route to template
- [ ] Document the client-side JS pattern (`main.ts`, page scripts) explaining how page-specific interactivity works
- [ ] Add comments to layout/component files explaining the composition pattern
- [ ] Ensure comments explain "why" and "how to follow this pattern", not just "what"

### Why

When an agent needs to add a new feature, it reads existing code to understand the pattern. Well-commented examples are the most effective way to teach agents the codebase conventions. Comments should answer: "If I need to add another one of these, what do I do?"

---

## Issue 5: Standardize and document file/folder conventions

**Labels:** `architecture`, `documentation`

### Summary

Ensure the project structure follows strict, predictable conventions so agents can confidently add new features without ambiguity about where files go or how they're named.

### Tasks

- [ ] Audit current structure for any inconsistencies
- [ ] Document the file placement rules:
  - Server routes: `/src/server/routes/`
  - Templates: `/src/server/templates/`
  - Server components: `/src/server/components/`
  - Services: `/src/server/services/`
  - Client JS: `/src/client/pages/`
  - Client CSS: `/src/client/pages/` (co-located) or `/src/client/components/`
  - Types: `/src/types/`
- [ ] Document naming conventions (kebab-case files, PascalCase components, etc.)
- [ ] Document how files connect: route -> service -> template -> client JS/CSS
- [ ] Consider adding a `_template` or generator pattern for scaffolding new pages
- [ ] Add this documentation to the agent context files (CLAUDE.md, etc.)

### Why

Predictable structure is critical for agents. If an agent can determine "a new page needs files in these 4 locations with these names", it can scaffold correctly every time.

---

## Issue 6: Add environment and configuration management

**Labels:** `infrastructure`, `dx`

### Summary

Add a proper config/env pattern so agents have a clear, documented way to add new configuration values.

### Tasks

- [ ] Add `.env.example` with documented placeholders
- [ ] Create a typed config module (`/src/server/config.ts`) that reads and validates env vars
- [ ] Add startup validation that fails fast with clear error messages for missing required config
- [ ] Add `.env` to `.gitignore`
- [ ] Document the pattern for adding new config values in agent context docs
- [ ] Consider using a validation library (e.g. Zod) for config schema

### Why

Agents frequently need to add configuration (API keys, feature flags, external service URLs). A clear pattern with typed access and validation means agents add config correctly and the app fails fast with helpful messages when something's missing.

---

## Issue 7: Audit and add agent-workflow scripts to package.json

**Labels:** `dx`, `tooling`

### Summary

Ensure `package.json` has a complete set of scripts that agents can run to validate their work, and that these are documented in agent context files.

### Tasks

- [ ] Audit existing scripts in `package.json`
- [ ] Ensure these scripts exist and work:
  - `bun run dev` — start dev server with watch mode
  - `bun run build` — production build
  - `bun run test` — run all tests
  - `bun run check` — run type checking + linting
  - `bun run format` — auto-format code
  - `bun run validate` — run everything in sequence (build, check, test)
- [ ] Add a `bun run validate` script that runs the full CI-equivalent pipeline locally
- [ ] Document all scripts and their purposes in agent context docs
- [ ] Ensure pre-commit hooks run the right checks

### Why

Agents need to validate their work. A single `bun run validate` command that runs build + lint + types + tests gives agents a one-step way to confirm everything works before committing.
