import type { BunRequest } from "bun";
import {
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  inspectCsrfToken,
  validateOrigin,
} from "../services/csrf";
import { log } from "../services/logger";
import { getSessionIdFromRequest } from "../services/sessions";

export interface CsrfOptions {
  method?: string; // Optional - used for validation if provided
  path: string;
  expectedOrigin?: string;
}

/**
 * Why a CSRF check failed.
 *
 * Everything except the two "expired-*" reasons is a hard failure. In
 * particular "invalid-origin" must never be treated as recoverable: it is the
 * actual cross-origin attack path, and re-issuing a token there would turn the
 * app into a token vending machine for attacker-initiated POSTs.
 */
export type CsrfFailureReason =
  | "method-mismatch"
  | "invalid-origin"
  | "missing-session"
  | "missing-token"
  | "invalid-token"
  | "rate-limited"
  | "expired-token"
  | "expired-session";

export type CsrfCheckResult =
  | { ok: true }
  | { ok: false; reason: CsrfFailureReason; response: Response };

/**
 * A stale token still proves possession of the session's CSRF secret, so the
 * caller may re-render the form with a fresh token instead of failing hard.
 * The action itself must not be performed either way.
 *
 * Only "expired-token" qualifies. "expired-session" is deliberately excluded:
 * with no secret to verify against there is no proof of authenticity, so a
 * forged token against a dead session is indistinguishable from a real one.
 */
export const isRecoverableCsrfFailure = (result: CsrfCheckResult): boolean =>
  !result.ok && result.reason === "expired-token";

/**
 * CSRF protection check
 * Validates CSRF token and Origin/Referer headers for state-changing requests,
 * reporting why the check failed so callers can offer recovery where it's safe
 */
export const checkCsrf = async (
  req: BunRequest,
  options: CsrfOptions,
): Promise<CsrfCheckResult> => {
  const { method: expectedMethod, expectedOrigin } = options;
  const actualMethod = req.method.toUpperCase();

  const fail = (
    reason: CsrfFailureReason,
    body: string,
    status: number,
  ): CsrfCheckResult => ({
    ok: false,
    reason,
    response: new Response(body, { status }),
  });

  // Assert method matches if provided (catch misconfigurations)
  if (expectedMethod && expectedMethod.toUpperCase() !== actualMethod) {
    log.error(
      "csrf",
      `Method mismatch - expected ${expectedMethod}, got ${actualMethod}`,
    );
    return fail("method-mismatch", "Invalid request configuration", 500);
  }

  // Only protect state-changing methods (use actual request method)
  const protectedMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!protectedMethods.includes(actualMethod)) {
    return { ok: true }; // Allow non-state-changing methods
  }

  // Validate Origin/Referer first (defense in depth)
  if (!validateOrigin(req, expectedOrigin)) {
    return fail("invalid-origin", "Invalid request origin", 403);
  }

  const sessionId = getSessionIdFromRequest(req);

  if (!sessionId) {
    return fail("missing-session", "Invalid CSRF token", 403);
  }

  // Extract CSRF token from header or form data
  let csrfToken: string | null = null;

  // Try header first (for API/AJAX requests)
  csrfToken = req.headers.get(CSRF_HEADER_NAME);

  // If no header, try form data (for HTML forms)
  // Clone request to avoid consuming body
  if (!csrfToken) {
    try {
      const contentType = req.headers.get("content-type");
      if (
        contentType?.includes("application/x-www-form-urlencoded") ||
        contentType?.includes("multipart/form-data")
      ) {
        const clonedReq = req.clone();
        const formData = await clonedReq.formData();
        csrfToken = formData.get(CSRF_FIELD_NAME) as string;
      }
    } catch (error) {
      // A malformed body parses to no token and fails below, which is right.
      // But clone() throwing means the body was *already read* — a controller
      // called readFormValues before checkCsrf, and every request through it
      // will 403. That ordering bug must not degrade silently.
      if (error instanceof TypeError && req.bodyUsed) {
        log.error(
          "csrf",
          `Body consumed before checkCsrf on ${options.path} — call checkCsrf before reading the form`,
        );
      }
    }
  }

  if (!csrfToken) {
    return fail("missing-token", "Invalid CSRF token", 403);
  }

  // Use normalized path from request URL for verification
  const requestUrl = new URL(req.url);
  const normalizedPath = requestUrl.pathname;

  // Inspect the CSRF token (use actual request method)
  const status = await inspectCsrfToken(
    sessionId,
    actualMethod,
    normalizedPath,
    csrfToken,
  );

  switch (status) {
    case "valid":
      return { ok: true };
    case "expired":
      return fail("expired-token", "Invalid CSRF token", 403);
    case "session-expired":
      return fail("expired-session", "Invalid CSRF token", 403);
    case "rate-limited":
      return fail("rate-limited", "Invalid CSRF token", 403);
    default:
      return fail("invalid-token", "Invalid CSRF token", 403);
  }
};

/**
 * CSRF protection middleware
 * Returns null when the request may proceed, or the failure Response to return
 */
export const csrfProtection = async (
  req: BunRequest,
  options: CsrfOptions,
): Promise<Response | null> => {
  const result = await checkCsrf(req, options);
  return result.ok ? null : result.response;
};
