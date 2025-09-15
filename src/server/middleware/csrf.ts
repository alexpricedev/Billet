import { getSessionIdFromCookies } from "../services/auth";
import {
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  validateOrigin,
  verifyCsrfToken,
} from "../services/csrf";

export interface CsrfOptions {
  method?: string; // Optional - used for validation if provided
  path: string;
  expectedOrigin?: string;
}

/**
 * CSRF protection middleware
 * Validates CSRF token and Origin/Referer headers for state-changing requests
 */
export const csrfProtection = async (
  req: Request,
  options: CsrfOptions,
): Promise<Response | null> => {
  const { method: expectedMethod, expectedOrigin } = options;
  const actualMethod = req.method.toUpperCase();

  // Assert method matches if provided (catch misconfigurations)
  if (expectedMethod && expectedMethod.toUpperCase() !== actualMethod) {
    console.error(
      `CSRF middleware: method mismatch - expected ${expectedMethod}, got ${actualMethod}`,
    );
    return new Response("Invalid request configuration", { status: 500 });
  }

  // Only protect state-changing methods (use actual request method)
  const protectedMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!protectedMethods.includes(actualMethod)) {
    return null; // Allow non-state-changing methods
  }

  // Validate Origin/Referer first (defense in depth)
  if (!validateOrigin(req, expectedOrigin)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  // Get session ID from cookies
  const cookieHeader = req.headers.get("cookie");
  const sessionId = getSessionIdFromCookies(cookieHeader);

  if (!sessionId) {
    return new Response("Invalid CSRF token", { status: 403 });
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
    } catch {
      // Form data parsing failed - continue with null token
    }
  }

  if (!csrfToken) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  // Use normalized path from request URL for verification
  const requestUrl = new URL(req.url);
  const normalizedPath = requestUrl.pathname;

  // Verify the CSRF token (use actual request method)
  const isValid = await verifyCsrfToken(
    sessionId,
    actualMethod,
    normalizedPath,
    csrfToken,
  );

  if (!isValid) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  return null; // Token is valid, allow request to continue
};
