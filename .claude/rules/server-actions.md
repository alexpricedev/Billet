---
paths:
  - "src/server/controllers/**"
  - "src/server/utils/**"
  - "src/server/templates/**"
  - "src/server/components/**"
---

# Forms, fragments and form actions

Loaded when you open a controller, template, component or server utility. The always-on rule —
three tiers, plain form by default — is in CLAUDE.md; this is the server half of the machinery.

## Every mutation is a form, and the fetch is an enhancement of it

The todo page's add, toggle and delete are plain `<form method="POST">`s that work without
JavaScript through the redirect-and-flash flow. `server.submit` (`src/client/reactive/request.ts`)
posts the same form with two headers: the form's CSRF token promoted to `X-CSRF-Token`, which
`checkCsrf` reads before the body, and `X-Fragment: 1`. A controller checks `isFragmentRequest(req)`
and answers with `renderFragment(<TodoRow />)` — the same server component the page renders with —
instead of the redirect; the client inserts or swaps the row and calls `bind`. The header names live
in `src/shared/protocol.ts` and `services/csrf.ts` re-exports them; don't spell them anywhere else.

A stale token on a fragment request gets `refreshCsrfToken()`: a 403 carrying a fresh token in the
same header, which `server.submit` writes back into the form and retries once. Only `expired-token`
gets that. A forged or cross-origin token fails hard with no header, exactly as a plain post does —
see `isRecoverableCsrfFailure` for why the distinction is load-bearing.

`server.submit` sends `redirect: "manual"`, so a controller that redirects reads as a failure rather
than a login page handed back as a row; `formAction` answers a fragment request that a guard
refused with a 401 (sent to `/login`) or 403 instead of the redirect. On any failure the component
falls back to `form.submit()`, and the server's flash says what happened. Never return a full page
to a fragment request, and never return a fragment to a plain post.

## POST controllers are `formAction` handlers, and GET controllers mint with `csrfTokens`

`formAction` (`src/server/utils/form-action.ts`) owns everything around the decision: the guard
(`"session"`, `"user"`, or a function such as `orgRoleGuard`), the CSRF check with stale-token
recovery on both paths, and the response — redirect-and-flash for a plain post, fragment or bare
status for a fragment request. A handler returns an outcome, not a Response: `{ flash, fragment,
status }` for success, `{ reject, flash }` for a refusal, or a `Response` as the escape hatch. The
same handler serves both kinds of request; it never checks which it got. Every POST controller
outside `controllers/auth/` uses it; the auth routes stay on the raw `checkCsrf` on purpose,
because re-issuing a token around a credential-bearing action is a different risk calculation.

`csrfTokens(ctx)` (`src/server/utils/csrf-tokens.ts`) is the GET side: `for(path)`,
`forUser(path)`, `forEach(rows, path)` and `nav()`, each null (or absent) when the session can't
mint, which the templates already treat as "render the form anyway". Tokens are minted in the
controller and passed as props; templates stay pure functions, which is what lets client tests
render them as fixtures.
