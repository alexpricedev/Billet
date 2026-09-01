# Security Runbook

Billet ships a defensive HTTP baseline: a single set of security headers on
**every** response, an enforcing Content Security Policy, HSTS in production,
a `/.well-known/security.txt`, and Subresource Integrity on its one third-party
script. Cookies and CSRF are covered separately in the root
[`SECURITY.md`](../SECURITY.md).

This runbook covers what's applied automatically, the one required config step,
how to extend each piece, the deploy- and DNS-layer steps a host can't do for
you, and how to verify it all in production.

Everything except the DNS/transport items is server-side and needs no client JS.

## 1. What's applied automatically

Every response — HTML pages, JSON APIs, static files, redirects, and error
pages — passes through one checkpoint and leaves with the same security headers.
The single source of truth is
[`src/server/utils/security-headers.ts`](../src/server/utils/security-headers.ts),
wired in [`src/server/main.ts`](../src/server/main.ts) two ways:

- `secureRoutes({...})` wraps every declared route handler.
- `withSecurityHeaders(await handleFallback(req))` wraps the static/asset/404 path.

`withSecurityHeaders` only fills in headers a response hasn't already set, so a
route can still override any single header (e.g. a relaxed CSP for one page).

| Header | Value | Notes |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Stops content-type guessing |
| `X-Frame-Options` | `DENY` | Legacy clickjacking defence (CSP `frame-ancestors` is the modern one) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits URL leakage to other sites |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates our browsing context |
| `Permissions-Policy` | deny-all baseline, `fullscreen=(self)` | Turns off camera, mic, geolocation, USB, payment, etc. |
| `Content-Security-Policy` | see §3 | Source allowlist + clickjacking + https upgrade |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | **Production only** (see §4) |

HSTS is intentionally withheld outside production (`NODE_ENV !== "production"`)
so local development over plain HTTP doesn't pin `localhost` to HTTPS.

One route sets an extra header of its own: **logout**
([`controllers/auth/logout.tsx`](../src/server/controllers/auth/logout.tsx))
sends `Clear-Site-Data: "cookies", "storage"` so the browser wipes cookies and
client storage on sign-out — defence in depth beyond deleting the session cookie.

## 2. Set the security.txt contact (required before launch)

[RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) `security.txt` tells
researchers how to report a vulnerability. Billet serves it dynamically at
`/.well-known/security.txt` from
[`src/server/services/security-txt.ts`](../src/server/services/security-txt.ts)
(controller: [`controllers/app/security-txt.ts`](../src/server/controllers/app/security-txt.ts),
route in [`routes/app.tsx`](../src/server/routes/app.tsx)).

- **`Contact:`** comes from the **`SECURITY_CONTACT`** env var (see
  [`.env.example`](../.env.example)). A bare email is wrapped in `mailto:`; a
  fully-qualified `mailto:` / `https:` / `tel:` URI is used as-is:

  ```bash
  SECURITY_CONTACT=security@yourdomain.com          # → Contact: mailto:security@yourdomain.com
  SECURITY_CONTACT=https://yourdomain.com/security  # → Contact: https://yourdomain.com/security
  ```

  With no env set it falls back to `mailto:security@<host-of-SITE_URL>` — a
  placeholder. Set a **monitored** address before you launch.
- **`Expires:`** is computed as one year from process start, so it never lapses;
  it refreshes on every deploy. No action needed.
- **`Canonical:`** is derived from `SITE_URL` in
  [`services/seo.ts`](../src/server/services/seo.ts) — the same constant the SEO
  runbook has you set. If SITE_URL is correct, this is correct.

## 3. Content Security Policy

The policy is enforcing and host-allowlist based. Current directives:

```
default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none';
img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline' https://unpkg.com https://esm.sh;
connect-src 'self'; upgrade-insecure-requests
```

`upgrade-insecure-requests` ships in production only, like HSTS: WebKit (unlike
Chrome) applies the upgrade to `http://localhost` subresources too, which strips
every asset off the page in local dev and under the browser smoke tests.

What it buys today: no other site can frame our pages (`frame-ancestors 'none'`),
no plugins (`object-src 'none'`), no `<base>` injection (`base-uri 'none'`), any
stray `http://` subresource is auto-upgraded to HTTPS, and code/styles/images may
only load from us plus the two named CDNs.

**Adding a new external source.** If you pull a script, style, image, font, or
API from a new origin, add that origin to the matching directive in
`security-headers.ts`:

- external `<script src>` → `script-src`
- external stylesheet or `@font-face` host → `style-src` / `font-src`
- `<img>` from a CDN → `img-src`
- `fetch()`/XHR/WebSocket to an API → `connect-src`

Forget one and the browser blocks the resource with a `Refused to load…` console
error. Test in a real browser after any change (see §6).

**The `'unsafe-inline'` tradeoff.** `script-src` includes `'unsafe-inline'`
because the page ships an inline import map and inline JSON-LD in
[`layouts.tsx`](../src/server/components/layouts.tsx). That weakens CSP's XSS
protection. The hardening path (a follow-up, not done here) is nonce +
`'strict-dynamic'`: generate a per-request nonce, stamp it on every inline and
first-party `<script>`, add `'nonce-…' 'strict-dynamic'` to `script-src`, and
drop `'unsafe-inline'`. The cleanest enabler is self-hosting Preact and lottie so
there are no CDN scripts and no inline import map to allow.

## 4. Subresource Integrity (third-party scripts)

The homepage loads the lottie animation library from unpkg with a pinned version
and a cryptographic hash in
[`layouts.tsx`](../src/server/components/layouts.tsx):

```html
<script async
  src="https://unpkg.com/lottie-web@5.13.0/build/player/lottie_light.min.js"
  integrity="sha384-…" crossorigin="anonymous"></script>
```

If unpkg ever serves a tampered file, the hash won't match and the browser
refuses to run it. **SRI requires an exact version** — never point `integrity`
at a floating range like `@5`.

**Bumping the version.** Recompute the hash for the new file:

```bash
curl -sL "https://unpkg.com/lottie-web@<NEW>/build/player/lottie_light.min.js" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Update both the `src` version and the `integrity` value.

**Preact / import map.** Preact is pinned (`@10.29.8`) but loaded via an ES
module import map, which has no SRI equivalent in current browsers. Pinning the
exact version is the mitigation. Self-hosting removes the third-party trust
entirely.

## 5. Deploy & transport layer (host, not code)

- **HTTPS / TLS.** Provided by the platform. Railway terminates TLS and redirects
  plain HTTP to HTTPS at the edge, so there is no in-app redirect. If you deploy
  elsewhere, confirm the edge does the HTTP→HTTPS redirect.
- **HSTS preload.** The header already advertises `preload`. To get baked into
  browsers, submit the apex domain at [hstspreload.org](https://hstspreload.org)
  **after** confirming every subdomain is HTTPS-only — preload is hard to undo.
- **`TRUST_PROXY=true` behind a reverse proxy.** The rate limiter keys requests by
  client address (`src/server/middleware/client-ip.ts`). Behind Railway (or any
  single proxy that rewrites/appends `x-forwarded-for` itself) set `TRUST_PROXY=true`
  so it reads the last header entry — the hop the proxy added; otherwise every
  visitor shares the proxy's socket address and one busy user 429s everyone.
  Never set it on a deployment reached directly: the header is client-controlled
  there, and trusting it lets an attacker walk past the `/login` limit with a
  fresh value per request.

## 6. Verify in production

```bash
# Headers present on a normal page
curl -sI https://yourdomain.com/ | grep -iE \
  'content-security-policy|strict-transport|x-content-type|permissions-policy'

# security.txt serves as text/plain with a real Contact + future Expires
curl -s https://yourdomain.com/.well-known/security.txt
```

- **In a browser:** load the site, open the console, confirm no `Refused to
  load…` / CSP violations and that the hero animation and any islands render.
- **Scanners:** [securityheaders.com](https://securityheaders.com),
  [Mozilla Observatory](https://observatory.mozilla.org), and Google's
  [CSP Evaluator](https://csp-evaluator.withgoogle.com) for policy strength.

Note: Chrome logs harmless `Unrecognized feature` warnings for a few
`Permissions-Policy` tokens it hasn't implemented (e.g. `battery`, `web-share`).
They don't affect security; trim those tokens in `security-headers.ts` if you
want a spotless console.

## 7. DNS layer (registrar, not code)

- **CAA records (recommended).** Restrict which certificate authorities may issue
  certs for your domain. Confirm your platform's CA first — a wrong CAA blocks
  renewals. Railway uses Let's Encrypt:

  ```
  yourdomain.com.  CAA  0 issue "letsencrypt.org"
  ```

- **DNSSEC (optional).** Enable at your registrar to cryptographically sign DNS
  records. One-click at most registrars; verify with
  [dnssec-analyzer.verisignlabs.com](https://dnssec-analyzer.verisignlabs.com).

## 8. Deliberately not implemented (yet)

- **Breached-password checks** — password mode (`AUTH_MODE=password`) enforces
  length only, per NIST SP 800-63B. Screening new passwords against a breach
  corpus is the one composition-adjacent check that measurably helps; it needs a
  k-anonymity lookup against Have I Been Pwned (or a local corpus) and an
  outbound call on the sign-up path, so it is left to the fork.
- **Multi-factor authentication** — no TOTP, WebAuthn, or emailed second factor.
  A magic link is already single-factor-by-email; passwords are single-factor by
  knowledge. Adding a second factor means new schema, recovery codes, and a
  re-authentication flow.
- **Password expiry / reuse history** — not implemented, and not recommended.
  Forced rotation drives predictable mutations; reuse history means retaining old
  hashes indefinitely.
- **Reporting API (`Reporting-Endpoints` + CSP `report-to`)** — needs a collector
  endpoint to receive violation reports. Add one to observe CSP breakage in the
  wild before tightening the policy.
- **COEP / CORP** — `Cross-Origin-Embedder-Policy` would break the unpkg/esm.sh
  scripts, and a strict `Cross-Origin-Resource-Policy` would block social scrapers
  from fetching the OG image. Only `Cross-Origin-Opener-Policy` is set. Revisit
  COEP if you ever need cross-origin isolation (e.g. `SharedArrayBuffer`).
- **Trusted Types** (`require-trusted-types-for 'script'`) — pairs naturally with
  the nonce-based CSP upgrade in §3.
- **Digest Fields (`Content-Digest`)** — transit-integrity hashes, optional and
  niche for a site behind HTTPS.
