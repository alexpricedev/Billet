import { getAuthContext } from "../../middleware/auth";
import { getVisitorStats } from "../../services/analytics";
import { getSessionIdFromCookies } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { Home } from "../../templates/home";
import { render } from "../../utils/response";

export const home = {
  async index(req: Request): Promise<Response> {
    const [stats, auth] = await Promise.all([
      getVisitorStats(),
      getAuthContext(req),
    ]);

    // Generate CSRF token for logout form if authenticated
    let csrfToken: string | null = null;
    if (auth.isAuthenticated) {
      const cookieHeader = req.headers.get("cookie");
      const sessionId = getSessionIdFromCookies(cookieHeader);
      if (sessionId) {
        csrfToken = await createCsrfToken(sessionId, "POST", "/auth/logout");
      }
    }

    return render(
      <Home
        method={req.method}
        stats={stats}
        auth={auth}
        csrfToken={csrfToken}
      />,
    );
  },
};
