import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { checkCsrf } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/rate-limit";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { createCsrfToken } from "../../services/csrf";
import { log } from "../../services/logger";
import { atLeast, getMembership } from "../../services/organizations";
import {
  type ChangePasswordResult,
  changePassword,
  type SetPasswordResult,
  setInitialPassword,
  userHasPassword,
} from "../../services/passwords";
import { teamsEnabled } from "../../services/teams-mode";
import type { AccountState } from "../../templates/account";
import { Account } from "../../templates/account";
import { render404 } from "../../utils/errors";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { readPassword } from "./form-guard";

const { getFlash, setFlash } = stateHelpers<AccountState>();

// "already-set" only happens when a password arrived from somewhere else — a
// second tab, or a reset link finished mid-flow — between the page rendering
// and this submit. Reloading shows the change form instead.
const PASSWORD_ERRORS = {
  "wrong-password": "That isn't your current password.",
  "invalid-password": "Password must be between 8 and 128 characters.",
  "already-set": "This account already has a password. Reload and try again.",
} as const;

export const account = {
  async index(req: BunRequest): Promise<Response> {
    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    const sessionId = ctx.sessionId;

    // Tokens are bound to a method and path, so each form on the page needs its
    // own — one token can't be reused across the three.
    const [csrfToken, resendCsrfToken, passwordCsrfToken] = await Promise.all([
      createCsrfToken(sessionId, "POST", "/auth/logout"),
      createCsrfToken(sessionId, "POST", "/auth/verify/resend"),
      createCsrfToken(sessionId, "POST", "/account/password"),
    ]);

    // Switching an existing app to password mode leaves every user without a
    // password, so the page has to offer "set one" rather than a change form
    // that can only ever fail on the current-password check.
    const hasPassword = passwordAuthEnabled()
      ? await userHasPassword(ctx.user.id)
      : false;

    // /team is not in the nav — neither is /admin — so this page is where
    // someone finds their team. One query, and only when the flag is on.
    const membership = teamsEnabled() ? await getMembership(ctx.user.id) : null;

    return render(
      <Account
        mode={authMode()}
        user={ctx.user}
        hasPassword={hasPassword}
        team={
          membership
            ? {
                name: membership.org.name,
                canManage: atLeast(membership.role, "admin"),
              }
            : null
        }
        state={getFlash(req)}
        csrfToken={csrfToken}
        resendCsrfToken={resendCsrfToken}
        passwordCsrfToken={passwordCsrfToken}
      />,
    );
  },

  async updatePassword(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    // Each attempt costs two argon2 verifications plus a hash, so an
    // authenticated flood is still worth throttling.
    const limited = rateLimit(req, 5, 60_000);
    if (limited) return limited;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: "/account/password",
    });
    // No recoverable branch here, unlike /forms: the only thing worth preserving
    // across a stale token would be the passwords themselves, and those must
    // never go into a flash cookie. The user retypes.
    if (!csrf.ok) return csrf.response;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionHash) return redirect("/login");

    const formData = await req.formData();
    const currentPassword = readPassword(formData, "current_password");
    const newPassword = readPassword(formData, "new_password");

    // Which of the two operations this is comes from the account's own state,
    // never from the shape of the submitted form — otherwise omitting
    // current_password would be a way to skip proving it.
    const hasPassword = await userHasPassword(ctx.user.id);

    // The purge of the other sessions throws rather than reporting a count of
    // zero, so a database failure lands here instead of being announced as
    // "signed out everywhere else". The password may or may not have changed by
    // that point, which is what the message has to say.
    let result: ChangePasswordResult | SetPasswordResult;

    try {
      result = hasPassword
        ? await changePassword(
            ctx.user.id,
            currentPassword,
            newPassword,
            ctx.sessionHash,
          )
        : await setInitialPassword(ctx.user.id, newPassword, ctx.sessionHash);
    } catch (error) {
      log.error("account", `password update failed: ${error}`);
      setFlash(req, {
        state: "password-error",
        error:
          "Something went wrong. Check whether your password changed before trying again, and sign out of your other devices.",
      });
      return redirect("/account");
    }

    if (!result.success) {
      setFlash(req, {
        state: "password-error",
        error: PASSWORD_ERRORS[result.error],
      });
      return redirect("/account");
    }

    setFlash(req, {
      state: hasPassword ? "password-changed" : "password-set",
    });
    return redirect("/account");
  },
};
