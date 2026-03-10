# Rebrand SpeedLoaf to Billet — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from SpeedLoaf to Billet and reposition the README around AI-agent-friendly, thin-frontend philosophy.

**Architecture:** This is a rebrand — no structural changes. Targeted string replacements across 4 source files, a new README section, and a lockfile regeneration.

**Tech Stack:** Bun, TypeScript, JSX templates

**Spec:** `docs/superpowers/specs/2026-03-10-rebrand-speedloaf-to-billet-design.md`

---

## Chunk 1: Mechanical Renames and README Evolution

### Task 1: Rename in package.json

**Files:**
- Modify: `package.json:2` (name field)
- Modify: `package.json:2-3` (add description after name)

- [ ] **Step 1: Update name and add description**

Change line 2 from:
```json
"name": "speedloaf",
```
to:
```json
"name": "billet",
"description": "A full-stack TypeScript starter designed to be built on by AI coding agents",
```

- [ ] **Step 2: Regenerate lockfile**

Run: `bun install`
Expected: bun.lock regenerated with new package name. No errors.

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: Lint and typecheck pass with zero warnings.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "🚚 Rename package from speedloaf to billet"
```

---

### Task 2: Rename in source files

**Files:**
- Modify: `src/server/templates/login.tsx:14`
- Modify: `SECURITY.md:5`

- [ ] **Step 1: Update login template**

In `src/server/templates/login.tsx` line 14, change:
```tsx
<BaseLayout title="Login - SpeedLoaf">
```
to:
```tsx
<BaseLayout title="Login - Billet">
```

- [ ] **Step 2: Update SECURITY.md**

In `SECURITY.md` line 5, change:
```
SpeedLoaf implements robust Cross-Site Request Forgery (CSRF) protection
```
to:
```
Billet implements robust Cross-Site Request Forgery (CSRF) protection
```

- [ ] **Step 3: Verify no remaining references**

Run: `grep -ri "speedloaf" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v bun.lock | grep -v docs/superpowers`
Expected: No output (zero remaining references outside docs and lockfile).

- [ ] **Step 4: Verify build**

Run: `bun run check`
Expected: Lint and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/templates/login.tsx SECURITY.md
git commit -m "🚚 Rename SpeedLoaf to Billet in source files"
```

---

### Task 3: Evolve README

**Files:**
- Modify: `README.md` (header block, new section, typo fixes)

- [ ] **Step 1: Update header block (lines 1-14)**

Replace lines 1-14 (logo through description paragraph). The tech badges block (lines 16-22) stays unchanged.

Change:
- Alt text: `"Speedloaf Logo"` → `"Billet Logo"`
- Title: `SpeedLoaf` → `Billet`
- Tagline and description: Replace with new agent-friendly positioning copy

New lines 1-14 should be:
```html
<!-- LOGO -->
<p align="center">
  <img src="public/logo.png" alt="Billet Logo" width="180" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>Full-stack TypeScript starter designed to be built on by AI coding agents</b>
  <br />
  An embarrassingly simple stack: server-rendered JSX, light-touch JS, Tailwind CSS. One codebase, one deploy target.<br />
  Strong types, clear architecture, and deterministic templates that AI agents can reason about and test with confidence.
</p>
```

- [ ] **Step 2: Insert "Why Billet?" section**

Insert a new section after the first `---` separator and before the `## Features` heading (use these markers rather than line numbers, since the header edit may shift lines):

```markdown
## Why Billet?

> **Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. Named for Sheffield — the Steel City, where crucible steel was invented.

Left to their own choices, AI coding agents will reach for what they know best: React with Next.js. The result is a thick-frontend app split across client and server, locked into a specific ecosystem, requiring multiple test systems to simulate browser state, and unnecessarily complex and costly to deploy.

Billet takes the opposite approach. It's a single-instance server-rendered app with light-touch client-side JavaScript. Templates are deterministic functions of their props — given the same input, they produce the same HTML. This makes them trivial to test in a single unified system without browser simulation. One codebase, one test runner, one deploy target.

This isn't a limitation. It's a deliberate architectural choice that plays to AI's strengths: strong type information to reason about, functional input/output patterns, and a feedback loop (write code → run tests → see results) that works in seconds, not minutes.
```

- [ ] **Step 3: Fix typos in existing content**

In the Features section, change:
```
- **TypeScript-first**: Everything is writte in TS and wired up by Bun
```
to:
```
- **TypeScript-first**: Everything is written in TS and wired up by Bun
```

In the Folder Structure section, change:
```
SpeedLoaf just wants you to seperate your backend logic
```
to:
```
Billet just wants you to separate your backend logic
```

- [ ] **Step 4: Final verification**

Run: `bun run check`
Expected: Lint and typecheck pass.

Run: `grep -ri "speedloaf" --include="*.md" . | grep -v node_modules | grep -v docs/superpowers`
Expected: No output.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "🚚 Rebrand README from SpeedLoaf to Billet"
```
