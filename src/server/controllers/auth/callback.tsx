import { createSessionCookie, verifyMagicLink } from "../../services/auth";
import { redirect } from "../../utils/response";

export const callback = {
  async index(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return redirect("/login?error=Missing authentication token");
    }

    try {
      const result = await verifyMagicLink(token);

      if (!result.success) {
        return redirect(`/login?error=${encodeURIComponent(result.error)}`);
      }

      const sessionCookie = createSessionCookie(result.sessionId);

      return new Response("", {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie": sessionCookie,
        },
      });
    } catch {
      return redirect("/login?error=Authentication failed. Please try again.");
    }
  },
};
