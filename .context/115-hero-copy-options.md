# #115 Hero copy options (proposal, not applied)

`src/server/templates/home.tsx` is unchanged. Each option is tag / h1 / sub; screenshots are in the PR.

**Current (baseline)** — tag: Full-stack TypeScript starter · h1: Give your agents guardrails

1. **Raw stock** — tag: A starter kit for software factories · h1: Stock for your software factory
   Sub: Billet is the raw stock a factory works: auth, security, migrations and 900+ tests already in place. Server-rendered JSX on Bun and PostgreSQL, one codebase, one test runner, one deploy target. Your agents start shaping product, not machining the parts every app needs.
   Why: ties to the "billet = semi-finished steel" definition block. h1 orphans "factory" on desktop.
2. **Throughput** — tag: Built for agent throughput · h1: Let your agents ship, safely
   Sub: Every agent run starts on a tested base: auth, security, migrations and 900+ tests, with checks that fail loudly when a change breaks the rules. One runner, one database, one deploy target.
   Why: shortest h1, one line on desktop; keeps the guardrails idea closest to the current copy.
3. **Factory floor** — tag: The factory floor, pre-built · h1: Tooling before the production line
   Sub: Before you scale up agents, set up the floor: auth, security headers, migrations and a 900+ test suite on Bun and PostgreSQL. Your software factory gets a fixture it can trust.
   Why: strongest factory metaphor; least literal.
4. **Parts** — tag: Starter kit for the software factory · h1: Parts every app needs, already made
   Sub: Auth, security, migrations and 900+ tests come as standard, so your agents spend their cycles on your product. Server-rendered TypeScript on Bun and PostgreSQL, built to one standard and deployed one way.
   Why: closest to the ticket's wording, plainest.

Suggested meta description (not applied), for option 2: "Billet is a full-stack TypeScript starter kit for software factories: auth, security, migrations and 900+ tests, so your agents ship on a tested base."

Recommendation: option 2 — fits on one line at 1280 and 3 lines at 390, and names both agents and safety. Option 1 if the steel/factory theme should lead.
