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
export const TIME_WINDOW_MINUTES = 15;

// Rate limiting - simple in-memory counter for failed attempts
const failureCounters = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES_PER_WINDOW = 10;
const FAILURE_WINDOW_MS = 60 * 1000; // 1 minute

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
 * Verify a CSRF token against the session, method, and path
 * Returns true if valid, false otherwise
 */
export const verifyCsrfToken = async (
  sessionId: string,
  method: string,
  path: string,
  providedToken: string,
): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(sessionId);

    // Check rate limiting
    if (isRateLimited(sessionIdHash)) {
      return false;
    }

    // Parse token format: nonce.token
    const parts = providedToken.split(".");
    if (parts.length !== 2) {
      recordFailure(sessionIdHash);
      return false;
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
      return false;
    }

    const csrfSecret = result[0].csrf_secret as string;

    // Normalize path to match token creation (remove query params and fragments)
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const pathOnly = normalizedPath.split("?")[0].split("#")[0];

    // Check current and previous time buckets (allow small clock skew)
    const now = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(now / (TIME_WINDOW_MINUTES * 60));
    const previousBucket = currentBucket - 1;

    for (const timeBucket of [currentBucket, previousBucket]) {
      const payload = `${nonce}${method.toUpperCase()}${pathOnly}${timeBucket}`;
      const expectedToken = createHmac("sha256", csrfSecret)
        .update(payload)
        .digest("base64url");

      // Timing-safe comparison
      if (
        token.length === expectedToken.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
      ) {
        clearFailures(sessionIdHash);
        return true;
      }
    }

    recordFailure(sessionIdHash);
    return false;
  } catch {
    recordFailure(computeHMAC(sessionId));
    return false;
  }
};

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

    // Determine expected origin from env or request
    const expected =
      expectedOrigin ||
      process.env.APP_ORIGIN ||
      `${new URL(req.url).protocol}//${new URL(req.url).host}`;

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
