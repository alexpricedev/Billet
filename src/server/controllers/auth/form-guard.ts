import type { BunRequest } from "bun";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/rate-limit";
import {
  CAPTCHA_SOLUTION_FIELD,
  HONEYPOT_FIELD,
  verifyCaptcha,
} from "../../services/captcha";

export type FormGuardResult =
  | { ok: true; formData: FormData }
  | { ok: false; reason: "rate-limited"; response: Response }
  | { ok: false; reason: "csrf"; response: Response }
  // The body comes back on these three so a caller can put the user back where
  // they were. /reset-password needs it: the token lives in the form, and
  // dropping it would send someone away to request a new email over a stale
  // captcha challenge while their existing token was still valid and unspent.
  // Nothing here is trusted — the caller re-reads and re-validates.
  | {
      ok: false;
      reason: "honeypot" | "captcha" | "csrf-expired";
      formData: FormData;
    };

/**
 * The layered bot defense every unauthenticated auth form runs, cheapest guard
 * first — each one short-circuits.
 *
 * 1. Rate limit: reject floods before parsing the body. Tighter than the
 *    default (10/5s) since every request here can send an email or burn an
 *    argon2 hash.
 * 2. CSRF: these forms are signed out, but they are not unauthenticated — a
 *    forged POST /login signs the victim into the *attacker's* account, and
 *    they go on working in it. The token binds to the guest session minted on
 *    the GET. It has to run before the body is read: checkCsrf clones the
 *    request to find the field, and a spent body 403s everything.
 * 3. Honeypot: a filled hidden field means a bot. The caller feigns success —
 *    creating nothing and sending nothing — so the bot has no signal to adapt
 *    to. Worth logging, because a false positive drops a real sign-in with no
 *    other trace.
 * 4. Captcha: a no-op that passes when disabled; otherwise the proof of work
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

  const csrf = await checkCsrf(req, {
    method: "POST",
    path: new URL(req.url).pathname,
  });

  // Forged, missing or cross-origin: nothing downstream can redeem it, so
  // don't spend a body parse on it either.
  if (!csrf.ok && !isRecoverableCsrfFailure(csrf)) {
    return { ok: false, reason: "csrf", response: csrf.response };
  }

  const formData = await req.formData();

  // Stale but authentic — an old tab. The caller re-renders behind a fresh
  // token; the action is not performed. Returned ahead of the honeypot and the
  // captcha because those are stale on that same page and their verdict can't
  // change the outcome.
  if (!csrf.ok) {
    return { ok: false, reason: "csrf-expired", formData };
  }

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
