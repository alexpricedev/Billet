import type { BunRequest } from "bun";
import { rateLimit } from "../../middleware/rate-limit";
import {
  CAPTCHA_SOLUTION_FIELD,
  HONEYPOT_FIELD,
  verifyCaptcha,
} from "../../services/captcha";

export type FormGuardResult =
  | { ok: true; formData: FormData }
  | { ok: false; reason: "rate-limited"; response: Response }
  // The body comes back on these two so a caller can put the user back where
  // they were. /reset-password needs it: the token lives in the form, and
  // dropping it would send someone away to request a new email over a stale
  // captcha challenge while their existing token was still valid and unspent.
  // Nothing here is trusted — the caller re-reads and re-validates.
  | { ok: false; reason: "honeypot" | "captcha"; formData: FormData };

/**
 * The layered bot defense every unauthenticated auth form runs, cheapest guard
 * first — each one short-circuits.
 *
 * 1. Rate limit: reject floods before parsing the body. Tighter than the
 *    default (10/5s) since every request here can send an email or burn an
 *    argon2 hash.
 * 2. Honeypot: a filled hidden field means a bot. The caller feigns success —
 *    creating nothing and sending nothing — so the bot has no signal to adapt
 *    to. Worth logging, because a false positive drops a real sign-in with no
 *    other trace.
 * 3. Captcha: a no-op that passes when disabled; otherwise the proof of work
 *    must verify. This is the real defense against automated submissions.
 *
 * Returns the parsed body on success so the caller doesn't re-read it — the
 * request stream is already spent by then.
 */
export const guardAuthForm = async (
  req: BunRequest,
): Promise<FormGuardResult> => {
  const limited = rateLimit(req, "auth", 5, 60_000);
  if (limited) {
    return { ok: false, reason: "rate-limited", response: limited };
  }

  const formData = await req.formData();

  if (formData.get(HONEYPOT_FIELD)) {
    return { ok: false, reason: "honeypot", formData };
  }

  if (!verifyCaptcha(formData.get(CAPTCHA_SOLUTION_FIELD) as string | null)) {
    return { ok: false, reason: "captcha", formData };
  }

  return { ok: true, formData };
};

/**
 * Read a password exactly as typed.
 *
 * Deliberately not `readFormValues`, which trims and drops empties: leading and
 * trailing whitespace is a legitimate part of a passphrase, and silently
 * stripping it on sign-in would reject a password that was accepted at sign-up.
 */
export const readPassword = (formData: FormData, field: string): string => {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
};

/** Emails, unlike passwords, are normalised — nobody means the spaces. */
export const readEmail = (formData: FormData): string => {
  const value = formData.get("email");
  return typeof value === "string" ? value.trim() : "";
};
