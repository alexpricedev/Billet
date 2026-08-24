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
import { redirect, render } from "../../utils/response";
import { landingAfterAuth } from "./landing";

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

    return render(
      <AuthConfirm intent="sign-in" token={token} csrfToken={csrfToken} />,
      // The page carries a live sign-in token: never store it, and never let a
      // back button re-present a form whose token has since been spent.
      { "Cache-Control": "no-store" },
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

    if (typeof token !== "string" || !token) {
      return redirect("/login?error=Missing authentication token");
    }

    try {
      const result = await verifyMagicLink(token, getSessionIdFromRequest(req));

      if (!result.success) {
        return redirect(`/login?error=${encodeURIComponent(result.error)}`);
      }

      setSessionCookie(req, result.sessionId);

      return new Response("", {
        status: 303,
        headers: { Location: await landingAfterAuth(result.user.id) },
      });
    } catch {
      return redirect("/login?error=Authentication failed. Please try again.");
    }
  },
};
