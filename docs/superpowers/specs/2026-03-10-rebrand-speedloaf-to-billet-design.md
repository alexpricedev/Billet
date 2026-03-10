# Rebrand SpeedLoaf to Billet — Design Spec

## Overview

Rename the project from SpeedLoaf to **Billet** and reposition it as a full-stack TypeScript starter specifically designed to be built on by AI coding agents.

**Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. The codebase AI agents shape into your application.

## Decisions

- **README approach:** Evolve existing content — keep structure, update identity and add new positioning section.
- **CLAUDE.md:** Leave as-is (no SpeedLoaf references, instructions still accurate).
- **Logo:** Keep current `public/logo.png` as placeholder until new logo is designed.

## File Changes

### Mechanical Renames

| File | Old | New |
|------|-----|-----|
| `package.json` | `"name": "speedloaf"` | `"name": "billet"` |
| `package.json` | (no description field) | Add `"description": "A full-stack TypeScript starter designed to be built on by AI coding agents"` |
| `bun.lock` | Auto-generated | Run `bun install` after package.json change to regenerate |
| `README.md` line 3 | `alt="Speedloaf Logo"` | `alt="Billet Logo"` |
| `README.md` line 6 | `<h1 align="center">SpeedLoaf</h1>` | `<h1 align="center">Billet</h1>` |
| `README.md` line 55 | `SpeedLoaf just wants you to seperate...` | `Billet just wants you to separate...` (also fix typo) |
| `SECURITY.md` line 5 | `SpeedLoaf implements robust...` | `Billet implements robust...` |
| `src/server/templates/login.tsx` line 14 | `"Login - SpeedLoaf"` | `"Login - Billet"` |

### README Evolution

**Header block (lines 1-22):**
- Alt text: `"Speedloaf Logo"` → `"Billet Logo"`
- Title: `SpeedLoaf` → `Billet`
- Replace current tagline (`"Ultra-fast, modern full-stack TS starter for Bun.sh based apps using familiar JSX templating"`) with new tagline that positions Billet as the agent-friendly alternative to thick-frontend defaults
- Replace the 3-line description block (lines 11-13) with updated copy reflecting the thin-frontend, agent-friendly philosophy
- Keep existing tech badges unchanged

**New "Why Billet?" section** (inserted after the first `---` separator on line 24, before `## Features` on line 26):

Content covers these points in ~150-200 words:
1. The name: steelmaking metaphor — a billet is semi-finished steel ready to be forged into something specific. Sheffield connection (Steel City, crucible steel).
2. The problem: AI agents left to their own choices default to React/Next.js thick frontends. This means ecosystem lock-in, bifurcated client/server apps, multiple test systems for simulating browser states, and unnecessarily complex and costly deployment.
3. The alternative: Billet starts your agent with an embarrassingly simple stack — a single-instance server-rendered app with light-touch JS. Templates are deterministic functions of props, testable in one unified system. One deploy target, not two.

**Features list (lines 26-38):**
- Keep all bullets as-is
- Fix typo: `"writte in TS"` → `"written in TS"` (line 37)

**Folder Structure (lines 53-66):**
- `"SpeedLoaf just wants you to seperate..."` → `"Billet just wants you to separate..."` (also fix typo)

**All other sections unchanged** (Quick Start, Contributing, Deploy, License, Sheffield footer).

## Scope Verification

A full-text search confirmed "SpeedLoaf" / "speedloaf" appears only in the files listed above. No references exist in `.env` files, `tsconfig.json`, `biome.json`, CI/CD configs, or source code beyond the files already covered.

## Out of Scope

- New logo design (separate task)
- GitHub repo rename (manual, separate task)
- Domain acquisition (manual, separate task)
- CLAUDE.md changes
