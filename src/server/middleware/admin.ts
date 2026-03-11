import type { BunRequest } from "bun";
import type { SessionContext } from "../services/sessions";
import { setFlashCookie } from "../utils/flash";
import { getSessionContext } from "./auth";

export type AdminResult =
  | { authorized: true; ctx: SessionContext }
  | { authorized: false; response: Response };

export const requireAdmin = async (req: BunRequest): Promise<AdminResult> => {
  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated) {
    return {
      authorized: false,
      response: new Response("", {
        status: 303,
        headers: { Location: "/login" },
      }),
    };
  }

  if (ctx.user?.role !== "admin") {
    setFlashCookie(req, "message", { text: "Admin access required" });
    return {
      authorized: false,
      response: new Response("", {
        status: 303,
        headers: { Location: "/" },
      }),
    };
  }

  return { authorized: true, ctx };
};
