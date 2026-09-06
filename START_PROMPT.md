# First-Time Setup

Follow these steps to make this project your own. Ask me for a project name and a PostgreSQL connection URL before you start, along with the two feature questions in step 1 — one round of questions rather than several.

## 1. Create `.env` and `.env.test`

Two behaviours are set by environment variable, and the file you're about to write is where they get chosen. Both ship at their defaults — magic-link sign-in, team management off — and both are cheaper to pick now than to switch once there are accounts, so ask before writing it:

1. **"Do you want email-and-password sign-in, or magic links?"** Magic links are the default: a one-time link by email, no password to store and no reset flow to support. Password mode (`AUTH_MODE=password`) is conventional email + password with argon2id hashing, and it turns on `/forgot-password`, `/reset-password`, and the change-password form on `/account` — all of which 404 in magic-link mode. The two are mutually exclusive on purpose; with both, every account has two ways in and the weaker one sets the ceiling. Switching later isn't fatal but it leaves existing accounts with no password, to be set from `/account` or `/forgot-password`.
2. **"Do you want team management turned on?"** Off by default (`TEAMS_ENABLED=true` turns it on): a `/team` page where an owner or admin invites people by email, sees the member list, changes org roles, and removes people. Off, `/team` and `/invites/accept` 404 and no org row is ever written. Worth saying before they answer: the org role is a separate axis from the platform `users.role` that gates `/admin`, so an org owner is not a platform admin; one user belongs to one org, with no switcher; core does not scope their own tables by org; and with it on, signing in without a membership lands on `/team` instead of `/`. [runbooks/TEAMS.md](runbooks/TEAMS.md) has the authorisation model.

Generate a fresh `CRYPTO_PEPPER` using `crypto.randomBytes(32).toString('hex')` and write a `.env` file. All eight variables below are required — the server validates them on startup via `src/server/utils/env.ts` and will refuse to boot if any are missing:

```
DATABASE_URL=<their postgres url>
CRYPTO_PEPPER=<generated>
PORT=3000
APP_URL=http://localhost:3000
APP_NAME=<Project Name>
EMAIL_PROVIDER=console
FROM_EMAIL=noreply@example.com
FROM_NAME=<Project Name>
```

Then add a line for each feature they said yes to:

```
AUTH_MODE=password
TEAMS_ENABLED=true
```

Leave the line out entirely when the answer was no — both variables default to off, and an unset variable is the documented default rather than a second place to keep in step. `.env.example` documents both in full if they want to read before deciding.

> **Note:** `APP_URL` must include the port (`:3000`). CSRF origin validation compares the request `Origin` header against `APP_URL` and will reject form submissions if they don't match exactly.

> **Tip:** If they're likely to run multiple billet apps on `localhost` at once (different ports), also set `SESSION_COOKIE_NAME=<project-slug>_session` in `.env`. Browsers scope cookies by hostname, not port, so the default `session_id` cookie collides across projects and they'll get logged out of one whenever they visit another.

If they don't have a PostgreSQL database yet, tell them they can create one locally with `CREATE DATABASE "<project-slug>";` and their URL will look like `postgresql://user:password@localhost:5432/<project-slug>`. Or they can ask you to set one up for them.

Also create `.env.test` for the test suite. It holds one key — a separate test database, so a test run can't truncate development data:

```
DATABASE_URL=<their postgres url but with -test appended to the database name>
```

> **Note:** One key is the whole file, whatever they chose above. Every other variable the suite needs is pinned by `src/server/test-utils/test-env.ts`, which `bunfig.toml` preloads into every test file — including the two features from the questions above, which tests expect at their defaults. Adding more keys here does nothing; the preload overrides them.

They'll need to create this database too (e.g. `CREATE DATABASE "<project-slug>-test";`).

## 2. Rename the project

Replace **Billet** with the chosen project name across the codebase. This is a case-sensitive find-and-replace in the files listed below — "Billet" becomes the display name, "billet" becomes a kebab-case slug derived from it.

**Files to update:**

| File | What to change |
|------|---------------|
| `package.json` | `name` field → slug |
| `SECURITY.md` | "Billet" → display name in prose |
| `src/server/templates/login.tsx` | Page title |
| `src/server/templates/home.tsx` | Page title |
| `src/server/templates/forms.tsx` | Page title |
| `src/server/templates/projects.tsx` | Page title |
| `src/server/components/layouts.tsx` | Logo text in `<span>Billet</span>` |
| `src/server/services/seo.ts` | `SITE_NAME` and `SITE_DESCRIPTION` → project name and description |

> **Keep `.billet-version`.** It records which Billet release this tree came from, and it is
> deliberately not on the list above — it isn't project identity, it's provenance. `version` in
> `package.json` is yours to bump; that file stays pointed at upstream, so you can later tell
> whether a fix you need is already here. Renaming or deleting it makes every future upgrade a
> source diff.

> **Note:** the canonical origin — used for `<link rel="canonical">`, Open Graph tags, the XML sitemap, `robots.txt`'s `Sitemap:` line, and JSON-LD across every page — is not a constant to rename. `siteUrl()` in `src/server/services/seo.ts` derives it from `APP_URL`, so pointing that env var at your production domain points all of them. The optional `SITE_URL` env var overrides it for the case where your canonical domain differs from your app domain — see [runbooks/SEO.md](runbooks/SEO.md) §1.

> **Note:** `SITE_NAME` also feeds the web app manifest (`/site.webmanifest` — the installed-app name/short name, built by `buildWebManifest()` in `seo.ts`) and the `X-Redirect-By` response header stamped on every redirect. Both are generated from that one constant, so renaming `SITE_NAME` renames them automatically — "Billet" never gets stuck in the installed-app name or redirect attribution. The manifest still references the icon files in `public/` (`android-chrome-192x192.png`, `android-chrome-512x512.png`, favicons, `apple-touch-icon.png`); swap those for your own artwork, and for a crisp Android adaptive icon provide a safe-zone-padded maskable variant (the 512px icon is reused as the maskable one by default).

## 3. Remove original repo references

These are links specific to the original Billet repository. Remove or update them:

- `src/server/templates/home.tsx` — The "Get Started" button linking to `github.com/new?template_name=Billet`. Change the href to `/` or their own repo URL.
- `src/server/components/layouts.tsx` — The footer GitHub link (`github.com/alexpricedev/Billet`). Update to their repo URL or remove.
- `src/server/components/layouts.tsx` — The "Built by alexprice.dev" attribution. Remove or replace.

`.billet-version` names the upstream repo too, and is the exception: leave it exactly as it is. It
is how you find out what upstream fixed after you forked — see the note in step 2.

## 4. Rewrite the home page

The home page (`src/server/templates/home.tsx`) is currently a marketing landing page for the Billet starter. It has:

- A hero section with tagline and "Get Started" button
- A "story" section with the Billet etymology and problem/approach prose
- A "backpressure" section explaining the development philosophy
- A "features" section listing what's included

Replace this with a simple welcome page for their project. Keep it minimal — just a heading with the project name and a short description. They'll build their own home page from here.

> **Note:** The home page currently loads a looping Lottie hero animation (`src/client/pages/home.ts`, gated behind `prefers-reduced-motion`). If your welcome page drops the animation, remove that init logic and the `/cube.json` asset too.

> **Accessibility:** Billet ships a WCAG-aligned baseline (labelled forms, keyboard focus rings, reduced motion, announced flash messages, captioned tables). Once you replace the placeholder theme with your own design language, **colour contrast and forced-colours support become your responsibility** — a framework can't decide your palette. See [runbooks/ACCESSIBILITY.md](runbooks/ACCESSIBILITY.md) for what's handled, what's yours, and how to verify.

> **Security:** Billet applies security headers, a Content Security Policy, HSTS, Subresource Integrity, and a Clear-Site-Data wipe on logout automatically. Two things need you: set `SECURITY_CONTACT` in your env (the `security.txt` reporting address — it defaults to a placeholder), and if you drop the Lottie hero above, its unpkg script in `src/server/components/layouts.tsx` goes too — one less third-party origin to trust. See [runbooks/SECURITY.md](runbooks/SECURITY.md) for that plus the TLS, HSTS-preload, CAA, and DNSSEC deploy steps.

> **Privacy:** Billet is privacy-clean by default — no analytics, no trackers, only strictly-necessary cookies — so **no cookie banner is legally required** as shipped. The moment you add analytics, ads, or third-party embeds, you must add an opt-in consent banner and a privacy policy. See [runbooks/PRIVACY.md](runbooks/PRIVACY.md) for wiring `@alexpricedev/billet-cookie-consent`, the required policy disclosures, GPC handling, and third-party-script hygiene.

## 5. Delete the stack page

Remove the stack page and all its associated files:

**Delete these files:**
- `src/server/templates/stack.tsx`
- `src/server/controllers/app/stack.tsx`
- `src/client/pages/stack.ts`
- `src/client/pages/stack.css`
- `src/client/pages/stack.test.ts`

**Remove references from:**
- `src/server/controllers/app/index.ts` — remove the `stack` barrel export
- `src/server/controllers/app/static.test.ts` — remove the stack test case
- `src/server/routes/app.tsx` — remove the `/stack` route entry and its import
- `src/server/components/nav.tsx` — remove the stack nav link
- `src/client/main.ts` — remove the stack import and `registerPage` call
- `src/client/style.css` — remove the `@import "./pages/stack.css"` line

## 6. Clean up the README

The README has marketing sections that should be stripped for a fork. Keep the useful reference sections, remove the sales pitch.

**Remove:**
- The logo, centered title, badges, TLDR quote, and "Get started" link (everything before the first `---`)
- "Why Billet?" section (etymology, philosophy, "when it isn't the right fit")
- "Built for AI Agents" section (architecture pitch, feedback stack table)
- The GitHub template link in Quick Start
- "Made with love in Sheffield" footer

**Keep:**
- What's Included
- Quick Start (but update to say `bun run dev` after cloning — the `.env` is already set up)
- Project Structure
- Contributing
- Deploy
- License

**Replace the header with:**

```markdown
# <Project Name>

A full-stack TypeScript app built with Bun.

---
```

Replace any remaining "Billet" references in the kept sections with the project name.

## 7. License (ask first)

Ask them: **"Do you want to keep the MIT license, or remove it?"**

If they want to **keep** it, leave everything as-is and skip to Verify.

If they want to **remove** it:

- Delete the `LICENSE` file.
- In `README.md`, remove the License badge near the top (the `<a href="LICENSE">...MIT...</a>` line) and the `## License` section near the bottom.
- Add a short note in the README (in place of the removed `## License` section) stating the project is unlicensed / all rights reserved, e.g.:

  ```markdown
  ## License

  This project is not currently licensed for public use. All rights reserved.
  ```

  (Or let them tell you a different license to swap in.)

## 8. Verify

Run `bun run check` to make sure there are no lint or type errors from the changes. Then run `bun run test` to confirm all tests pass. Start the dev server with `bun run dev` and check it works at http://localhost:3000.
