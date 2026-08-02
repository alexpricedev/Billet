import { createHmac, timingSafeEqual } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { db } from "./database";

// CSRF configuration constants
export const CSRF_HEADER_NAME = "X-CSRF-Token";
export const CSRF_FIELD_NAME = "_csrf";
export const CSRF_SECRET_LENGTH = 32;
export const CSRF_NONCE_LENGTH = 16;

// Tokens are bucketed by time. Verification accepts the current and previous
// bucket, so a token's effective lifetime is TIME_WINDOW_MINUTES..2x depending
// on where in the window the page happened to render.
export const TIME_WINDOW_MINUTES = 15;

// Older buckets accepted for *recovery only* - never to perform the action.
// A token matching one of these proves possession of the session's secret, so
// the caller can safely re-render the form with a fresh token instead of a 403.
export const CSRF_GRACE_WINDOWS = 8;

/**
 * Outcome of inspecting a token. Only "valid" may perform the action, and only
 * "expired" - which proves possession of the session secret - is safe to
 * recover from by re-issuing a token.
 */
export type CsrfTokenStatus =
  | "valid"
  | "expired"
  | "session-expired"
  | "invalid"
  | "rate-limited";

// Rate limiting - simple in-memory counter for failed attempts
const failureCounters = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES_PER_WINDOW = 10;
const FAILURE_WINDOW_MS = 60 * 1000; // 1 minute

// Expired-but-authentic tokens don't count toward the failure brake (see
// inspectCsrfToken), so they get their own far looser ceiling to cap replay of
// a captured old token. No human submits 60 stale forms in a minute.
const EXPIRED_COUNTER_PREFIX = "expired:";
const MAX_EXPIRED_PER_WINDOW = 60;

/**
 * Ensure a CSRF secret exists for the given session
 * Generates and stores a new secret if none exists
 * Returns empty string if session doesn't exist
 */
export const ensureCsrfSecret = async (sessionId: string): Promise<string> => {
  const sessionIdHash = computeHMAC(sessionId);

  // Try to get existing secret
  const result = await db`
    SELECT csrf_secret 
    FROM sessions 
    WHERE id_hash = ${sessionIdHash} 
      AND expires_at > CURRENT_TIMESTAMP
  `;

  // If no session exists, return empty string
  if (result.length === 0) {
    return "";
  }

  // If secret already exists, return it
  if (result[0].csrf_secret) {
    return result[0].csrf_secret as string;
  }

  // Generate new secret
  const csrfSecret = generateSecureToken(CSRF_SECRET_LENGTH);

  // Try to be the single writer - conditional UPDATE
  const updateResult = await db`
    UPDATE sessions 
    SET csrf_secret = ${csrfSecret}
    WHERE id_hash = ${sessionIdHash} 
      AND expires_at > CURRENT_TIMESTAMP
      AND csrf_secret IS NULL
  `;

  // Check if we won the race
  if (hasAffectedRows(updateResult as DatabaseMutationResult)) {
    // We set the secret successfully
    return csrfSecret;
  }

  // Another request won the race, fetch their secret
  const reselect = await db`
    SELECT csrf_secret 
    FROM sessions 
    WHERE id_hash = ${sessionIdHash} 
      AND expires_at > CURRENT_TIMESTAMP
  `;

  if (reselect.length > 0 && reselect[0].csrf_secret) {
    return reselect[0].csrf_secret as string;
  }

  // Session expired or deleted during the race
  return "";
};

/**
 * Create a CSRF token for the given session, method, and path
 * Token format: nonce.token
 * Token = HMAC-SHA256(csrf_secret, nonce || method || normalized_path || timestamp_bucket)
 */
export const createCsrfToken = async (
  sessionId: string,
  method: string,
  path: string,
): Promise<string> => {
  const csrfSecret = await ensureCsrfSecret(sessionId);
  if (!csrfSecret) {
    throw new Error("Cannot create CSRF token: session not found");
  }

  const nonce = generateSecureToken(CSRF_NONCE_LENGTH);

  // Normalize path to just pathname (remove query params and fragments)
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const pathOnly = normalizedPath.split("?")[0].split("#")[0];

  // Create timestamp bucket (15-minute windows)
  const now = Math.floor(Date.now() / 1000);
  const timeBucket = Math.floor(now / (TIME_WINDOW_MINUTES * 60));

  // Create token payload: nonce + method + normalized_path + time_bucket
  const payload = `${nonce}${method.toUpperCase()}${pathOnly}${timeBucket}`;

  // Generate HMAC token
  const token = createHmac("sha256", csrfSecret)
    .update(payload)
    .digest("base64url");

  return `${nonce}.${token}`;
};

/**
 * Inspect a CSRF token against the session, method, and path
 *
 * Distinguishes a stale-but-authentic token from a forged one. A token whose
 * HMAC verifies against an older bucket proves the holder has this session's
 * secret - it is only stale, not untrusted - so callers can offer the user a
 * fresh token rather than a dead end.
 */
export const inspectCsrfToken = async (
  sessionId: string,
  method: string,
  path: string,
  providedToken: string,
): Promise<CsrfTokenStatus> => {
  try {
    const sessionIdHash = computeHMAC(sessionId);

    // Check rate limiting
    if (isRateLimited(sessionIdHash)) {
      return "rate-limited";
    }

    // Parse token format: nonce.token
    const parts = providedToken.split(".");
    if (parts.length !== 2) {
      recordFailure(sessionIdHash);
      return "invalid";
    }

    const [nonce, token] = parts;

    // Get session's CSRF secret
    const result = await db`
      SELECT csrf_secret
      FROM sessions
      WHERE id_hash = ${sessionIdHash}
        AND expires_at > CURRENT_TIMESTAMP
        AND csrf_secret IS NOT NULL
    `;

    if (result.length === 0 || !result[0].csrf_secret) {
      recordFailure(sessionIdHash);
      return "session-expired";
    }

    const csrfSecret = result[0].csrf_secret as string;

    // Normalize path to match token creation (remove query params and fragments)
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const pathOnly = normalizedPath.split("?")[0].split("#")[0];

    const now = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(now / (TIME_WINDOW_MINUTES * 60));

    const matchesBucket = (timeBucket: number): boolean => {
      const payload = `${nonce}${method.toUpperCase()}${pathOnly}${timeBucket}`;
      const expectedToken = createHmac("sha256", csrfSecret)
        .update(payload)
        .digest("base64url");

      // Timing-safe comparison
      return (
        token.length === expectedToken.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
      );
    };

    // Check current and previous time buckets (allow small clock skew)
    for (const timeBucket of [currentBucket, currentBucket - 1]) {
      if (matchesBucket(timeBucket)) {
        clearFailures(sessionIdHash);
        return "valid";
      }
    }

    // Older buckets within the grace range: authentic, just stale.
    for (let offset = 2; offset <= 1 + CSRF_GRACE_WINDOWS; offset++) {
      if (matchesBucket(currentBucket - offset)) {
        // Deliberately neither recordFailure nor clearFailures. The brake
        // exists to stop guessing, and there is nothing to guess once the HMAC
        // verifies - counting these would let a user with several stale tabs
        // lock themselves out. Clearing them would let one captured old token
        // reset an attacker's counter indefinitely.
        if (isExpiredFlooding(sessionIdHash)) {
          return "invalid";
        }
        return "expired";
      }
    }

    recordFailure(sessionIdHash);
    return "invalid";
  } catch {
    recordFailure(computeHMAC(sessionId));
    return "invalid";
  }
};

/**
 * Verify a CSRF token against the session, method, and path
 * Returns true only for a token fresh enough to perform the action
 */
export const verifyCsrfToken = async (
  sessionId: string,
  method: string,
  path: string,
  providedToken: string,
): Promise<boolean> =>
  (await inspectCsrfToken(sessionId, method, path, providedToken)) === "valid";

/**
 * Validate request Origin/Referer header against expected origin
 */
export const validateOrigin = (
  req: Request,
  expectedOrigin?: string,
): boolean => {
  try {
    const origin = req.headers.get("Origin");
    const referer = req.headers.get("Referer");

    const expected =
      expectedOrigin || new URL(process.env.APP_URL as string).origin;

    if (origin) {
      return origin === expected;
    }

    if (referer) {
      const refererOrigin = new URL(referer).origin;
      return refererOrigin === expected;
    }

    // No Origin or Referer header - reject
    return false;
  } catch {
    return false;
  }
};

/**
 * Rate limiting helper functions
 */
const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const counter = failureCounters.get(key);

  if (!counter) {
    return false;
  }

  if (now > counter.resetAt) {
    failureCounters.delete(key);
    return false;
  }

  return counter.count >= MAX_FAILURES_PER_WINDOW;
};

const recordFailure = (key: string): void => {
  const now = Date.now();
  const counter = failureCounters.get(key);

  if (!counter || now > counter.resetAt) {
    failureCounters.set(key, {
      count: 1,
      resetAt: now + FAILURE_WINDOW_MS,
    });
  } else {
    counter.count++;
  }
};

const clearFailures = (key: string): void => {
  failureCounters.delete(key);
};

/**
 * Count an expired-token hit and report whether the session is over the (much
 * looser) expired ceiling. Keeps replay of a captured stale token bounded
 * without letting ordinary retries trip the main failure brake.
 */
const isExpiredFlooding = (sessionIdHash: string): boolean => {
  const key = `${EXPIRED_COUNTER_PREFIX}${sessionIdHash}`;
  const now = Date.now();
  const counter = failureCounters.get(key);

  if (!counter || now > counter.resetAt) {
    failureCounters.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    return false;
  }

  counter.count++;
  return counter.count > MAX_EXPIRED_PER_WINDOW;
};
