import type { BunRequest } from "bun";
import { findUserByEmail, regenerateSession } from "../../services/auth";
import {
  DEV_LOGIN_ACCOUNTS,
  devLoginEnabled,
  isDevLoginAccount,
  isDevLoginToken,
} from "../../services/dev-login";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import { render404 } from "../../utils/errors";
import { safeNextPath } from "../../utils/next-path";
import { redirect } from "../../utils/response";
import { landingAfterAuth } from "./landing";

/**
 * Where a dev sign-in link lands. See `services/dev-login.ts` for what turns it
 * on; with the flag off this is a 404 like any other unknown path.
 *
 * A GET that signs in, where every emailed link is a confirm step and a POST.
 * That rule is about single-use tokens a mail scanner can burn by fetching the
 * link: this one is never mailed and is not spent, so there is nothing to burn
 * and a confirm page would only add a click to the thing built to remove one.
 */
export const devLogin = {
  async index(req: BunRequest): Promise<Response> {
    if (!devLoginEnabled()) return render404();

    const url = new URL(req.url);
    const as = url.searchParams.get("as");

    // The same answer as the flag being off, so a request without the token
    // can't tell whether the route is live.
    if (
      !isDevLoginAccount(as) ||
      !isDevLoginToken(as, url.searchParams.get("token"))
    ) {
      return render404();
    }

    const account = DEV_LOGIN_ACCOUNTS[as];
    const user = await findUserByEmail(account.email);

    // Never created and never corrected. A missing row means the database
    // wasn't seeded, and minting a platform admin on demand is the hole
    // seedIfEmpty avoids. A changed role means someone edited the account in
    // /admin, and the "user" link signing in an admin would be worse than it
    // refusing.
    if (!user || user.role !== account.role) {
      const problem = user
        ? `${account.email} is no longer a platform ${account.role}`
        : `${account.email} does not exist in this database`;
      return redirect(
        `/login?error=${encodeURIComponent(`Dev sign-in unavailable: ${problem}.`)}`,
      );
    }

    const sessionId = await regenerateSession(
      user.id,
      getSessionIdFromRequest(req),
    );
    setSessionCookie(req, sessionId);

    return redirect(
      await landingAfterAuth(
        user.id,
        safeNextPath(url.searchParams.get("next")),
      ),
    );
  },
};
