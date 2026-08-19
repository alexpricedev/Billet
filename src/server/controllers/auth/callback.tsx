import type { BunRequest } from "bun";
import { verifyMagicLink } from "../../services/auth";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import { redirect } from "../../utils/response";
import { landingAfterAuth } from "./landing";

export const callback = {
  async index(req: BunRequest): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
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
