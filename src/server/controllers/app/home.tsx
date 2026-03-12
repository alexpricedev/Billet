import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { getVisitorStats } from "../../services/analytics";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import { Home } from "../../templates/home";
import { render } from "../../utils/response";

export const home = {
  async index(req: BunRequest): Promise<Response> {
    const [stats, ctx] = await Promise.all([
      getVisitorStats(),
      getSessionContext(req),
    ]);

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let csrfToken: string | undefined;
    if (ctx.isAuthenticated && ctx.sessionId) {
      csrfToken = await createCsrfToken(ctx.sessionId, "POST", "/auth/logout");
    }

    return render(
      <Home
        visitorCount={stats.visitorCount}
        lastUpdated={new Date(stats.lastUpdated)}
        user={ctx.user}
        csrfToken={csrfToken}
      />,
    );
  },
};
