import { createHash, randomInt } from "node:crypto";
import { computeHMAC, generateSecureToken, verifyHMAC } from "../utils/crypto";

// First-party proof-of-work captcha. No third party, no account, no new secret:
// challenges are signed with the app's existing CRYPTO_PEPPER (via computeHMAC),
// so this is self-hosted and stateless. Modeled on the Altcha protocol but built
// against Billet's own crypto. Enabled per-app with CAPTCHA_ENABLED=true; when off,
// verifyCaptcha() passes everything through so callers stay unconditional.

// Shared field names — the login template, controller, and client solver must all
// agree on these. The client bundle hardcodes the same literals (it cannot import
// this module, which pulls in node:crypto), and a test cross-checks the two.
// Neutral name on purpose: no email/name/address/company/url token, so native
// browser autofill won't populate it (that produced real dropped signups). The
// Honeypot component also sets password-manager opt-out attributes.
export const HONEYPOT_FIELD = "referral_code";
export const CAPTCHA_SOLUTION_FIELD = "captcha_solution";

// How hard the client has to work: it brute-forces a number in [0, maxnumber].
// ~100k SHA-256 hashes is sub-second for a real browser but a real cost at spam
// scale. Tunable per-app with CAPTCHA_DIFFICULTY.
const DEFAULT_DIFFICULTY = 100_000;

// Generous validity window: the challenge is embedded in the login page render, so
// this covers a user who leaves the tab open before submitting. A failed verify
// re-renders a fresh challenge anyway.
const CHALLENGE_TTL_MS = 30 * 60 * 1000;

const USED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface CaptchaChallenge {
  salt: string;
  challenge: string; // target SHA-256 hex the client must reproduce
  expires: number; // epoch ms
  maxnumber: number; // search space size
  signature: string; // HMAC over `${salt}:${challenge}:${expires}`
}

interface CaptchaSolution {
  salt: string;
  challenge: string;
  expires: number;
  signature: string;
  number: number; // the client's found answer
}

// Single-use replay guard: a solved signature can only be spent once. Stateless
// otherwise — mirrors the in-memory map + interval cleanup in rate-limit.ts.
const usedSignatures = new Map<string, number>();

export const captchaEnabled = (): boolean =>
  process.env.CAPTCHA_ENABLED === "true";

const difficulty = (): number => {
  const configured = Number(process.env.CAPTCHA_DIFFICULTY);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_DIFFICULTY;
};

const sha256hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const signChallenge = (
  salt: string,
  challenge: string,
  expires: number,
): string => computeHMAC(`${salt}:${challenge}:${expires}`);

// Build a fresh challenge. The answer is never sent to the client — it must be
// rediscovered by brute force.
export const issueChallenge = (): CaptchaChallenge => {
  const maxnumber = difficulty();
  const salt = generateSecureToken(16);
  const expires = Date.now() + CHALLENGE_TTL_MS;
  const answer = randomInt(0, maxnumber + 1);
  const challenge = sha256hex(`${salt}${answer}`);
  const signature = signChallenge(salt, challenge, expires);
  return { salt, challenge, expires, maxnumber, signature };
};

const parseSolution = (payload: string): CaptchaSolution | null => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) return null;
  const s = decoded as Record<string, unknown>;
  if (
    typeof s.salt !== "string" ||
    typeof s.challenge !== "string" ||
    typeof s.signature !== "string" ||
    typeof s.expires !== "number" ||
    typeof s.number !== "number"
  ) {
    return null;
  }
  return {
    salt: s.salt,
    challenge: s.challenge,
    signature: s.signature,
    expires: s.expires,
    number: s.number,
  };
};

// The security boundary. Returns true only when the payload is a genuine, unexpired,
// unmodified, actually-solved, not-yet-spent challenge we issued. Passes through
// (true) when captcha is disabled so callers need no feature check of their own.
export const verifyCaptcha = (payload: string | null): boolean => {
  if (!captchaEnabled()) return true;
  if (!payload) return false;

  const solution = parseSolution(payload);
  if (!solution) return false;

  const { salt, challenge, expires, signature, number } = solution;

  // 1. Not expired.
  if (expires <= Date.now()) return false;

  // 2. We issued it and salt/challenge/expires are unmodified (timing-safe).
  let signatureValid: boolean;
  try {
    signatureValid = verifyHMAC(`${salt}:${challenge}:${expires}`, signature);
  } catch {
    // Malformed signature (wrong length/non-hex) throws in timingSafeEqual.
    return false;
  }
  if (!signatureValid) return false;

  // 3. The proof of work was actually performed.
  if (sha256hex(`${salt}${number}`) !== challenge) return false;

  // 4. Single-use: reject replays, then mark spent.
  if (usedSignatures.has(signature)) return false;
  usedSignatures.set(signature, expires);

  return true;
};

const cleanupUsedSignatures = (): void => {
  const now = Date.now();
  for (const [signature, expires] of usedSignatures.entries()) {
    if (expires <= now) usedSignatures.delete(signature);
  }
};

// Test seam — clear the replay guard between cases.
export const clearUsedChallenges = (): void => {
  usedSignatures.clear();
};

// Don't let the cleanup timer keep the process (or the test runner) alive. The
// `unref` guard is because the happy-dom test preload can swap in a browser-style
// setInterval that returns a plain number with no unref().
const cleanupTimer: { unref?: () => void } = setInterval(
  cleanupUsedSignatures,
  USED_CLEANUP_INTERVAL_MS,
);
cleanupTimer.unref?.();
