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