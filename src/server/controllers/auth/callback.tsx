import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { verifyMagicLink } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import { AuthConfirm, CALLBACK_PATH } from "../../templates/auth-confirm";
import type { LoginState } from "../../templates/login";
import { safeNextPath, withNext } from "../../utils/next-path";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { landingAfterAuth } from "./landing";

const { setFlash } = stateHelpers<LoginState>();

/**
 * Where a magic link lands, in two halves: the GET shows a confirm step and
 * the POST spends the token. See `AuthConfirm` for why the redemption can't
 * live on the GET.
 */
export const callback = {
  async index(req: BunRequest): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return redirect("/login?error=Missing authentication token");
    }

    // The token is deliberately not looked up here. Checking it would either
    // spend it — the whole thing this page exists to avoid — or report whether
    // a guess was real without committing to it.
    const ctx = await getSessionContext(req);

    // The form's CSRF token is cut from the session's secret, so that session
    // has to reach the browser along with the page holding the form.
    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    const csrfToken = ctx.sessionId
      ? await createCsrfToken(ctx.sessionId, "POST", CALLBACK_PATH)
      : null;

    // Carried from the login form into the emailed URL, and validated again
    // here: it has been through a mail client since the site last saw it.
    const next = safeNextPath(url.searchParams.get("next"));

    return render(
      <AuthConfirm
        intent="sign-in"
        token={token}
        csrfToken={csrfToken}
        next={next}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const csrfFailure = await csrfProtection(req, {
      method: "POST",
      path: CALLBACK_PATH,
    });
    if (csrfFailure) return csrfFailure;

    const formData = await req.formData();
    const token = formData.get("token");
    const next = safeNextPath(formData.get("next"));

    if (typeof token !== "string" || !token) {
      return redirect(
        withNext("/login?error=Missing authentication token", next),
      );
    }

    try {
      const result = await verifyMagicLink(token, getSessionIdFromRequest(req));

      if (!result.success) {
        // The address rides the flash cookie rather than the query string, so
        // it stays out of URLs and logs.
        if (result.email) {
          setFlash(req, {
            state: "validation-error",
            error: result.error,
            email: result.email,
          });
          return redirect(withNext("/login", next));
        }

        return redirect(
          withNext(`/login?error=${encodeURIComponent(result.error)}`, next),
        );
      }

      setSessionCookie(req, result.sessionId);

      return new Response("", {
        status: 303,
        headers: { Location: await landingAfterAuth(result.user.id, next) },
      });
    } catch {
      return redirect(
        withNext("/login?error=Authentication failed. Please try again.", next),
      );
    }
  },
};
