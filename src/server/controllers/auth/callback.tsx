import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { verifyMagicLink } from "../../services/auth";
import { setSessionCookie } from "../../services/sessions";
import { redirect } from "../../utils/response";

export const callback = {
  async index(req: BunRequest): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return redirect("/login?error=Missing authentication token");
    }

    try {
      const ctx = await getSessionContext(req);
      const guestSessionId = ctx.isGuest ? ctx.sessionId : null;
      const result = await verifyMagicLink(token, guestSessionId);

      if (!result.success) {
        return redirect(`/login?error=${encodeURIComponent(result.error)}`);
      }

      setSessionCookie(req, result.sessionId);

      return new Response("", {
        status: 303,
        headers: { Location: "/" },
      });
    } catch {
      return redirect("/login?error=Authentication failed. Please try again.");
    }
  },
};
