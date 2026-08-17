import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import { Home } from "../../templates/home";
import { getFlashCookie } from "../../utils/flash";
import { render } from "../../utils/response";

export const home = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let csrfToken: string | undefined;
    if (ctx.isAuthenticated && ctx.sessionId) {
      csrfToken = await createCsrfToken(ctx.sessionId, "POST", "/auth/logout");
    }

    // Guards redirect here when they turn someone away — requireAdmin has set
    // this key since it was written, but nothing ever read it, so the message
    // was dropped unread on the next request. stateHelpers only reads "state",
    // which is why this one is fetched directly.
    const { text } = getFlashCookie<{ text?: string }>(req, "message");

    return render(
      <Home user={ctx.user} csrfToken={csrfToken} message={text} />,
    );
  },
};
