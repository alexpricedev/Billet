# Privacy Runbook

Billet ships **privacy-clean by default**: no analytics, no advertising, no
third-party trackers, and only strictly-necessary first-party cookies. Out of
the box there is nothing to consent to and — under the GDPR/ePrivacy rules — no
cookie banner is legally required.

That changes the moment you add anything non-essential: an analytics script, a
marketing pixel, an embedded video, an A/B tool, or any code that writes to
`localStorage`/`sessionStorage`/`IndexedDB`. At that point you owe your visitors
an **opt-in consent banner** and a **privacy policy**. This runbook covers the
default posture, the exact trigger for needing consent, and how to wire up the
[`@alexpricedev/billet-cookie-consent`](https://github.com/alexpricedev/billet-cookie-consent)
package plus a privacy policy when you cross that line.

Billet is a framework. It cannot ship your privacy policy for you — the copy
depends entirely on what *your* deployment collects. What it can do is stay clean
by default and hand you the pattern.

## 1. What's privacy-clean by default

| Area | Default state | Where |
|---|---|---|
| Analytics | None. `analytics.ts` is a mock (`getVisitorStats()` returns a fake count); `/api/stats` is unused | [`src/server/services/analytics.ts`](../src/server/services/analytics.ts) |
| Cookies | Only strictly-necessary: `session_id` (auth) and `flash_*` (transient/OAuth state), all HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production | [`sessions.ts`](../src/server/services/sessions.ts), [`utils/flash.ts`](../src/server/utils/flash.ts) |
| Client storage | None. No `localStorage`/`sessionStorage`/`IndexedDB` anywhere in `src/client/` | — |
| Fonts | Self-hosted (`font-src 'self'`) — no Google Fonts, no external font CDN | [`security-headers.ts`](../src/server/utils/security-headers.ts) |
| Third-party egress | `connect-src 'self'` blocks XHR/fetch/beacon to other origins | [`security-headers.ts`](../src/server/utils/security-headers.ts) |
| Request logging | No IP, user-agent, headers, or request bodies logged in the request path | [`services/logger.ts`](../src/server/services/logger.ts) |

Because these cookies are strictly necessary (session, security, transient
post-redirect-get state), they are **exempt** from consent under the ePrivacy
Directive — but they still need **disclosure** in a privacy policy (see §4).

## 2. The trigger: when you actually need a consent banner

You need a banner **before** the first non-essential storage or tracking call —
never on an ordinary page view of the default site. Add one when you introduce
any of:

- Analytics or product-metrics scripts (Plausible, GA, PostHog, etc.)
- Advertising / retargeting pixels or tags
- Social or video embeds that set cookies (YouTube, Twitter, etc.)
- A/B testing or session-replay tools
- Any client code writing to `localStorage`/`sessionStorage`/`IndexedDB` for a
  non-essential purpose

**Strictly-necessary cookies never need consent** — Billet's `session_id` and
`flash_*` stay banner-free. The rule is *behavioural*: what your site does before
the user interacts, not whether a banner is on screen.

## 3. Wire up the consent banner

Use [`@alexpricedev/billet-cookie-consent`](https://github.com/alexpricedev/billet-cookie-consent) —
vanilla DOM, zero dependencies, scoped CSS tokens, designed to drop into Billet.
The package README is the source of truth; adapt snippets to this repo's
controller/template signatures. Read it first:

```
node_modules/@alexpricedev/billet-cookie-consent/README.md
```

**Install**

```bash
bun add @alexpricedev/billet-cookie-consent
```

**Step 1 — import the CSS once** in [`src/client/style.css`](../src/client/style.css):

```css
@import "@alexpricedev/billet-cookie-consent/styles.css";
```

**Step 2 — initialise on the client.** Create `src/client/pages/consent.ts` and
register it in [`src/client/main.ts`](../src/client/main.ts) with
`import "./pages/consent";` so it runs on every page:

```ts
import { CookieConsent } from "@alexpricedev/billet-cookie-consent";

const consent = CookieConsent.init({
  categories: [
    { id: "necessary", label: "Strictly necessary", required: true,
      description: "Required for the site to function. Always on." },
    { id: "analytics", label: "Analytics",
      description: "Helps us understand how the site is used." },
    { id: "marketing", label: "Marketing",
      description: "Used to personalise ads and content." },
  ],
  policyUrl: "/privacy",
});

if (consent.has("analytics")) loadAnalytics();
document.addEventListener("cc:consent-granted", (e) => {
  if (e.detail.category === "analytics") loadAnalytics();
});

// "Manage cookies" trigger — data attribute, never inline onclick, so it fits
// Billet's server-JSX + islands model.
for (const el of document.querySelectorAll<HTMLElement>("[data-cc-open-prefs]")) {
  el.addEventListener("click", () => CookieConsent.current()?.show());
}

function loadAnalytics(): void {
  // Your analytics loader. Must be idempotent — only run once.
}
```

**Step 3 — add the withdraw-consent control.** GDPR requires users be able to
change their mind, so render a "Manage cookies" button in the footer
([`src/server/components/layouts.tsx`](../src/server/components/layouts.tsx)):

```tsx
<button type="button" data-cc-open-prefs>Manage cookies</button>
```

**Step 4 (recommended) — gate scripts server-side** so opted-out users never
even receive the analytics `<script>` tag. Read the cookie in the controller and
thread the flag into the template:

```tsx
import { parseConsent } from "@alexpricedev/billet-cookie-consent/server";

export const home = {
  index(req: Request): Response {
    const consent = parseConsent(req.headers.get("cookie"));
    return render(<Home analytics={consent?.state.analytics === true} />);
  },
};
```

```tsx
{props.analytics && <script src="https://plausible.io/js/script.js" defer />}
```

> Only import `parseConsent` once you have a real script to gate — Billet's
> `noUnusedLocals` lint will reject an unused import. Defer §4 until then.

**Theming** — the banner ships in its own default look. Map Billet's design
tokens onto the `--cc-*` variables on `[data-cc-root]` (in your global CSS) so it
matches the site; nothing leaks out of that scope. See the package README's
Theming section for the full token list.

**Non-negotiables** the package enforces or expects (spec §"Cookie consent"):

- **Never** set `HttpOnly` on the consent cookie — the client must read it.
- No non-essential script loads before the user opts in (that's what §Step 4 gives you).
- Accept and reject must be equal-weight, single-click; no pre-ticked non-essential boxes (avoid `default: true` — CJEU *Planet49* makes pre-ticked consent invalid).
- The choice is stored with a timestamp and schema version in the `cc_consent` cookie; a footer "Manage cookies" link lets users withdraw anytime.

## 4. The privacy policy (required once you collect anything)

A consent banner without a policy is non-compliant. If you add tracking, add a
`/privacy` page (service → template → controller → route → footer link, per
`CLAUDE.md`'s "Adding a New Page") and set `policyUrl: "/privacy"`. The policy
must disclose, at minimum:

1. **Controller identity** — legal/entity name, postal address, privacy contact
2. **Data categories** — what you collect (account, usage, IP/technical, payment…).
   With `AUTH_MODE=password` this includes an authentication credential: the
   stored argon2id hash of the user's password, plus `email_verified_at`
3. **Processing purposes** — why, per category
4. **Lawful basis** — GDPR Art. 6 per purpose (consent, contract, legitimate interest…)
5. **Recipients / processors** — name them (e.g. your analytics vendor, host), and any non-EU/UK transfers + safeguards
6. **Retention periods** — how long, per category
7. **User rights** — access, rectify, erase, restrict, port, object, complain to a supervisory authority
8. **Cookies & tracking** — inline or link to a cookie notice
9. **Last-updated date** — visible at the top

Link it from the footer on every page, keep it reachable without login, name
specific partners (not vague categories), and update the date when it changes.

## 5. Global Privacy Control (GPC)

GPC is a browser signal (`Sec-GPC: 1` header / `navigator.globalPrivacyControl`)
that legally means "do not sell or share my data" in California, Colorado, and
others. Billet does not read it because there is nothing to suppress by default.

Once you add tracking, honour it:

- Read `req.headers.get("sec-gpc") === "1"` (or `navigator.globalPrivacyControl`
  client-side) and treat it as a standing opt-out of the analytics/marketing
  categories — don't load those scripts, regardless of visitor location.
- Apply it to **all** users (strictest applicable preference for multi-region).
- Disclose GPC handling in the privacy policy (§4). Even the default site can add
  a one-line "we run no sale/sharing, so there is nothing for GPC to stop."
- GPC is *not* the GDPR cookie banner — it's a separate opt-out signal. Honour both.

## 6. Third-party script hygiene

Every `<script src>` from another origin can read the DOM, non-`HttpOnly`
cookies, `localStorage`, and the URL — the largest source of web data leaks. When
you add one:

- **Allowlist it in CSP.** Add the origin to `script-src`/`connect-src` in
  [`security-headers.ts`](../src/server/utils/security-headers.ts) — keep the
  default `connect-src 'self'` as tight as possible.
- **Prefer self-hosting** fonts, libraries, and icons over CDN loads.
- **Pin with Subresource Integrity** on stable URLs (as Billet already does for
  the Lottie script) so a compromised CDN can't swap the file.
- **Gate non-essential scripts behind consent** (§3, Step 4).
- **Re-audit periodically** — list every contacted domain in DevTools' network
  panel and justify each one.

> Framework maintainer note: the esm.sh Preact modules loaded via the inline
> importmap in `layouts.tsx` carry no SRI (importmaps can't express `integrity`).
> Self-host Preact or pin to an immutable versioned URL if you want them covered.

## 7. Data minimisation & logging

Collect only what a specific purpose needs, keep it only as long as needed, and
keep it out of logs. Billet's request path already logs no PII — preserve that:

- **Don't log IPs, user-agents, headers, or request bodies** in production. Use
  `log.*(category, message)` from [`services/logger.ts`](../src/server/services/logger.ts)
  with non-PII messages. This matters more in password mode: the bodies of
  `POST /login`, `/signup`, `/reset-password`, and `/account/password` all carry
  a plaintext password. Nothing in the request path logs them today — don't add
  a body dump to debug a form.
- **Don't store raw IPs.** The rate-limit middleware keys an in-memory map by IP
  and never persists it — keep it that way if you wire it into routes.
- **Redact secrets and personal data** before logging; separate identifiers from
  behavioural data; set and enforce retention windows on anything you do store.
- **Expired rows are swept hourly**, not left to accumulate.
  [`services/cleanup.ts`](../src/server/services/cleanup.ts) starts a timer from
  `main.ts` that deletes expired `user_tokens` and `sessions`, plus — with
  `TEAMS_ENABLED=true` — expired invites that were never accepted. Nothing reads
  an expired row either way (every query filters `expires_at`), so this is
  purely a retention measure: a spent magic-link token keeps a live-looking hash,
  and a lapsed invite keeps the invitee's email address. Accepted invites are
  kept deliberately as the record of who joined via whom. **A new table with an
  expiry needs its own sweep added there** — the runbook's "enforce retention
  windows" line is that file, and nothing else will notice the omission.

> Framework maintainer note: `ConsoleLogProvider`
> ([`email-providers/console.ts`](../src/server/services/email-providers/console.ts))
> logs the full outbound email — recipient address and the single-use URL, be it
> a magic-link sign-in, an address confirmation, or a password reset — to stdout. It is a dev provider; make sure your production `EmailService` wiring
> ([`email.ts`](../src/server/services/email.ts)) never selects it, or those land
> in platform logs.

## 8. Verify

After wiring up consent:

```bash
bun run check    # lint + typecheck still pass
bun run test     # suite still green
```

Then in a browser (or the `/browse` skill):

1. Hard-reload the site — the banner appears.
2. Click **Reject all** — banner disappears; no analytics request fires; `document.cookie` contains `cc_consent=…` but no analytics cookie.
3. Reload — no banner (choice remembered).
4. Click the footer **Manage cookies** link — the preferences modal opens; ESC closes it.
5. Accept analytics — the gated script loads exactly once.
6. `curl -sI` a page with `Sec-GPC: 1` — confirm the analytics script is *not* injected server-side (if you implemented §5 gating).
7. View-source `/privacy` (if added) — returns `200`, shows the last-updated date and a footer link on every page.

## 9. Non-goals

Deliberately **not** shipped, and why:

- **A bundled privacy policy page** — the copy is deployment-specific (what *you*
  collect, under what basis). Billet stays clean by default and gives you §4 as
  the template.
- **A consent banner in the default build** — legally unnecessary with zero
  non-essential storage, and shipping one would train users to click through a
  meaningless dialog. Add it via §3 the moment you add tracking.
- **Storage Access API wiring** — only relevant to cross-site embedded content
  needing partitioned cookies; the default site has no cross-site iframes.
- **Server-side GPC/analytics enforcement in core** — there's nothing to enforce
  until you add tracking; §5 shows the pattern to add alongside it.
