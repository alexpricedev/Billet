import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { checkCsrf } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/rate-limit";
import {
  createUserToken,
  EMAIL_VERIFICATION_EXPIRY_HOURS,
} from "../../services/auth";
import { passwordAuthEnabled } from "../../services/auth-mode";
import { getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import { verifyEmailToken } from "../../services/passwords";
import type { AccountState } from "../../templates/account";
import { VerifyResult } from "../../templates/verify-result";
import { appUrl } from "../../utils/app-url";
import { render404 } from "../../utils/errors";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { setFlash } = stateHelpers<AccountState>();

/**
 * Email confirmation. Only reachable in password mode — a magic-link account is
 * verified by the act of signing in, so there is nothing here for it to do.
 */
export const verify = {
  async index(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    const token = new URL(req.url).searchParams.get("token");
    const user = token ? await verifyEmailToken(token) : null;

    // Renders its own page rather than redirecting to /account, and deliberately
    // does not sign anyone in: the token proves the address is reachable, not
    // that whoever opened the link is the account holder. Those two together
    // mean the link works from any device — a mail client's browser or a phone
    // would otherwise be bounced to /login with the result thrown away.
    return render(<VerifyResult status={user ? "verified" : "invalid"} />);
  },

  async resend(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    // Each resend sends mail, so it gets the same tight budget as /login.
    const limited = rateLimit(req, 5, 60_000);
    if (limited) return limited;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: "/auth/verify/resend",
    });
    if (!csrf.ok) return csrf.response;

    const ctx = await getSessionContext(req);

    if (!ctx.isAuthenticated || !ctx.user) {
      return redirect("/login");
    }

    if (ctx.user.email_verified_at) {
      setFlash(req, { state: "verified" });
      return redirect("/account");
    }

    try {
      const token = await createUserToken(ctx.user.id, "email_verification");

      await getEmailService().sendVerifyEmail({
        to: { email: ctx.user.email },
        verifyUrl: appUrl(`/auth/verify?token=${token}`),
        expiryHours: EMAIL_VERIFICATION_EXPIRY_HOURS,
      });

      setFlash(req, { state: "verification-sent" });
    } catch (error) {
      log.error("verify", `failed to send verification email: ${error}`);
      setFlash(req, {
        state: "verify-failed",
        error: "We couldn't send that email. Please try again in a moment.",
      });
    }

    return redirect("/account");
  },
};
