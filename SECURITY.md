# Security Features

## CSRF Protection

Billet implements robust Cross-Site Request Forgery (CSRF) protection using the **synchronizer token pattern**.

### Key Features
- **Per-session secrets** with HMAC-SHA256 tokens bound to method + path
- **Origin/Referer validation** and SameSite cookies for defense in depth
- **Rate limiting** on failed attempts (10 per minute per session)
- **Timing-safe comparison** to prevent timing attacks

### Usage

#### 1. Controller Setup
```typescript
import { getAuthContext, requireAuth } from "../../middleware/auth";
import { getSessionIdFromCookies } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { csrfProtection } from "../../middleware/csrf";

// GET handler - generate token for forms
async index(req: Request): Promise<Response> {
  const auth = await getAuthContext(req);
  let csrfToken: string | null = null;
  
  if (auth.isAuthenticated) {
    const sessionId = getSessionIdFromCookies(req.headers.get("cookie"));
    if (sessionId) {
      csrfToken = await createCsrfToken(sessionId, "POST", "/examples");
    }
  }
  
  return render(<MyTemplate csrfToken={csrfToken} isAuthenticated={auth.isAuthenticated} />);
}

// POST handler - validate token
async create(req: Request): Promise<Response> {
  const authRedirect = await requireAuth(req);
  if (authRedirect) return authRedirect;

  const csrfResponse = await csrfProtection(req, {
    method: "POST",
    path: "/examples",
  });
  if (csrfResponse) return csrfResponse;

  // Process request...
}
```

#### 2. Template with CsrfField Component
```tsx
import { CsrfField } from "../components/csrf-field";

{isAuthenticated ? (
  <form method="POST" action="/examples">
    <CsrfField token={csrfToken} />
    <input type="text" name="data" />
    <button type="submit">Submit</button>
  </form>
) : (
  <p>Please <a href="/login">log in</a> to access this feature.</p>
)}
```

#### 3. AJAX Requests
```javascript
// Include token in X-CSRF-Token header
const csrfToken = document.querySelector('[name="_csrf"]')?.value;

fetch('/api/examples', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({ name: 'Example' }),
});
```

### Protected Methods
CSRF protection applies to: POST, PUT, PATCH, DELETE

### What It Prevents
- ✅ Cross-site form submissions from malicious sites
- ✅ Cross-site AJAX requests without proper tokens  
- ✅ Token reuse across sessions, methods, or paths
- ✅ Replay attacks (time-bounded tokens)
- ✅ Timing attacks (constant-time comparison)

## Additional Security

- **Session Management**: HMAC-protected IDs, secure cookies, 30-day expiration
- **Input Validation**: Type-safe forms, parameterized queries, XSS prevention
- **Environment Security**: Crypto pepper, environment isolation, no secret logging
- **Emailed links are built from `APP_URL`**, never from the request — `appUrl`
  in [`utils/app-url.ts`](src/server/utils/app-url.ts). `new URL(req.url).host`
  is the client's `Host` header, so deriving a link from it would let a forged
  header put an attacker's domain into a real, unspent magic-link or
  password-reset URL

## Password Storage (`AUTH_MODE=password`)

Only relevant when the app runs in password mode; in the default magic-link mode
no password is ever stored.

- **argon2id via `Bun.password`**, with the per-hash salt argon2 generates. Only
  the hash reaches `users.password_hash`; the plaintext exists for the length of
  one request.
- **Deliberately unpeppered.** Every other hash in the app is keyed with
  `CRYPTO_PEPPER`, but passwords are not. Rotating the pepper today logs everyone
  out — recoverable. Peppered passwords would instead become permanently
  unverifiable, forcing a reset for every user. Argon2's own salt already defeats
  rainbow tables.
- **Length-only policy**: 8–128 characters, no composition rules (NIST SP
  800-63B). Values are never trimmed, so whitespace is part of the password.
- **Passwords never enter flash state.** Failed forms preserve the email address
  and nothing else; the flash cookie is signed but client-readable.
- **Timing-equalised sign-in.** An unknown address, and an account with no
  password, both still run a verification against a dummy hash, so response time
  never separates them from a wrong password. The dummy hash is burnt on the
  no-password branch too: that branch's *message* differs by design (below), but
  its timing must not leak the same fact a second way, through a channel the
  rate limit can't see.

### Enumeration posture

`/forgot-password` answers identically whether or not an account exists.
Sign-in answers identically for a **wrong password** and an **unknown address** —
those two are one `invalid-credentials` result in `signInWithPassword`, and must
render as one message.

**Two deliberate exceptions**, both because the alternative strands a real user:

- **Sign-up** can't hide that an address is taken. It signs the user in
  immediately, so "pretend it worked" would mean either logging someone into an
  account they may not own or claiming success for an account that was never
  created. A visitor who submits a registered address is told so and pointed at
  sign-in.
- **Sign-in against an account with no password** — one carried over from
  magic-link mode — returns `no-password` and says so, with a link to
  `/forgot-password`. There is no password such a user could type correctly, so
  the generic message is a permanent dead end for exactly the people a mode
  switch affects.

The cost of the second is real and worth naming: submitting an address with any
password reveals whether it is a registered *carried-over* account. Registered
password accounts stay indistinguishable from unknown addresses, so the oracle
is scoped to accounts that predate the switch and closes for each one as it sets
a password. The only mitigation is the per-IP rate limit on the form
(5/60s, `guardAuthForm`). A fork that would rather keep sign-in fully
non-enumerable should collapse `no-password` back into `invalid-credentials` in
`services/passwords.ts` and drop the branch in `controllers/auth/login.tsx` —
its carried-over users then have to find `/forgot-password` unaided.

### Setting a first password

Accounts that predate a switch to password mode have no `password_hash`, so
`/account` offers them a set-password form with no current-password field, and a
failed sign-in points them at `/forgot-password` — which sets a first password on
a null hash just as it replaces an existing one.
Which of the two operations runs is read from the account's own state, never
inferred from the fields the form submits, and `setInitialPassword` scopes its
UPDATE with `AND password_hash IS NULL` — omitting `current_password` from a
crafted POST is not a way past the current-password check, and the SQL predicate
also closes the race against a reset landing at the same moment.

### Session invalidation

- A **password reset** destroys every session the user had — it's the flow you
  use when you believe someone else has your account, so nothing prior is
  trusted. A fresh session is issued afterwards.
- A **password change** from `/account` keeps the current session and destroys
  the rest, evicting anyone holding a stolen one. Setting a first password does
  the same — the account gains a credential, and anything else holding a session
  predates it.
- Reset and verification tokens are single-use, type-scoped, and stored only as
  an HMAC — the same `user_tokens` mechanism as magic links.

## HTTP Headers, CSP & Transport

The defensive HTTP baseline — security headers on every response, an enforcing
Content Security Policy, HSTS, `/.well-known/security.txt`, Subresource
Integrity, and the deploy/DNS steps — lives in
[`runbooks/SECURITY.md`](runbooks/SECURITY.md). Read it before your first deploy:
the `security.txt` contact address needs setting, and TLS/HSTS-preload/CAA/DNSSEC
are host- and registrar-level steps.