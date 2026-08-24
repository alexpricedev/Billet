# Email Deliverability Runbook

Every email the app sends is transactional and goes through Resend. The built-in
ones are the magic-link login (`AUTH_MODE=magic-link`) and, in password mode, the
address-confirmation and password-reset messages. Landing in the inbox (not spam) depends
almost entirely on DNS: SPF, DKIM, and DMARC. This runbook is domain-agnostic —
replace `<your-domain>` with your real sending domain throughout.

There are no marketing/bulk sends here, so List-Unsubscribe, BIMI, MTA-STS, and
open/click tracking are intentionally out of scope (see [Non-goals](#6-non-goals)).

## 1. Resend domain verification

1. In the Resend dashboard, add `<your-domain>` under **Domains**.
2. Resend issues DNS records — publish all of them with your DNS provider:
   - **DKIM** — a TXT record (`resend._domainkey.<your-domain>` or similar) that
     lets Resend sign messages. This is the single biggest deliverability lever.
   - **Custom Return-Path (bounce) domain** — an MX and a TXT record on a
     subdomain such as `send.<your-domain>`. This aligns SPF against your domain.
3. **SPF** is satisfied via the Return-Path records above — you do **not** need
   to edit any root-domain SPF record *unless you already send mail from
   `<your-domain>` through another provider*, in which case merge Resend's
   `include:` into your existing single `v=spf1 …` record (one SPF record only).
4. Wait for Resend to show the domain as **Verified** before sending.

## 2. Sending identity

- Verify the **root domain** so the From address is `something@<your-domain>`.
- Send from a **monitored** address (e.g. `hello@<your-domain>`), not `noreply@`.
  A monitored mailbox that receives replies earns engagement reputation; a
  `noreply@` address quietly accrues a penalty. If From must stay unmonitored,
  set `REPLY_TO_EMAIL` to a monitored address instead (the app adds it as
  `Reply-To` on the user-facing emails).
- Keep the From domain **aligned with `APP_URL`**. Magic-link URLs point at
  `APP_URL`; when the link domain matches the From domain, DMARC aligns and
  recipients see a consistent identity. Misalignment looks like phishing.
- **Subdomain isolation** (e.g. sending from `mail.<your-domain>`) is a valid
  later option to protect the root domain's reputation, but it is not required
  to start. Begin on the root domain; split out a subdomain only if you add
  higher-volume or riskier streams later.

## 3. DMARC progression

Publish a DMARC policy at `_dmarc.<your-domain>` (TXT) and tighten it in stages:

1. Start in monitor mode:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc@<your-domain>; fo=1
   ```
2. Monitor the aggregate (`rua`) reports for **2–4 weeks**. Confirm all
   legitimate mail passes SPF and/or DKIM with alignment.
3. Move to `p=quarantine` (spam-folder failures). Monitor again.
4. Move to `p=reject` (drop failures outright) once you are confident no
   legitimate mail fails.

Never jump straight to `p=reject` — you will silently drop real mail during any
misconfiguration.

## 4. Verification checklist

- **Gmail "Show original"** — send a magic link to a Gmail account, open the
  message, ⋮ → *Show original*. SPF, DKIM, and DMARC must all read **PASS**.
- **[mail-tester.com](https://www.mail-tester.com)** — send to the address it
  gives you; aim for **10/10**. It flags missing records, blocklists, and
  content issues.
- **[Google Postmaster Tools](https://postmaster.google.com)** — add and verify
  `<your-domain>` to watch domain reputation and spam rate over time.

## 5. Link scanners spend single-use tokens

Corporate mail security (Microsoft Defender Safe Links, Proofpoint URL Defense,
Google's own scanners) fetches every URL it delivers, before any human sees the
message. A `GET` that redeems a single-use token is therefore redeemed by the
scanner, and the recipient clicks a link that is already dead — with no way for
the page to explain why.

So every link the app emails renders a confirm step on `GET` and spends its token
on `POST`: `/auth/callback` (sign-in), `/auth/verify` (address confirmation),
`/reset-password` and `/invites/accept` (which were always two-step). Scanners
follow links; they don't submit forms. Do not "simplify" any of these back into
a one-shot `GET`, and give any new emailed link the same shape.

Two rules that are not symmetrical between them:

- **`/auth/callback` POSTs are CSRF-checked**, because a cross-site auto-submit
  there is login CSRF — dropping a visitor into a session they never asked for.
  The `GET` mints a guest session so the form has a secret to sign with, which
  means it needs cookies to work.
- **`/auth/verify` POSTs are not**, and set no cookie. Confirming an address
  creates no session, and the token is the only thing presented, so there is
  nothing to forge; keeping it cookie-free is what lets the link work from a
  mail client's own browser. The rate limit is the guard there instead.

Neither confirm page may be cached — both carry a live token, so both send
`Cache-Control: no-store`.

## 6. Non-goals

Deliberately **not** implemented, and why:

- **List-Unsubscribe / RFC 8058** — a bulk/marketing requirement. It is
  semantically wrong on transactional auth mail (you can't "unsubscribe" from
  your own login code).
- **BIMI** — logo-in-inbox; requires a VMC certificate and enforced DMARC for
  marginal benefit on transactional mail.
- **MTA-STS** — inbound transport security; irrelevant to an outbound-only
  transactional sender.
- **Open/click tracking** — keep Resend's open and click tracking **OFF**.
  Click tracking rewrites links through a shared tracking domain, which hurts
  deliverability and makes magic-link URLs look untrustworthy. The same applies
  to password-reset and confirmation links: a rewritten single-use token is a
  token a scanner can burn before the recipient clicks it.
