import type { BunRequest } from "bun";
import {
  atLeast,
  getMembership,
  type Membership,
  type OrgRole,
} from "../services/organizations";
import type { SessionContext } from "../services/sessions";
import { teamsEnabled } from "../services/teams-mode";
import { render404 } from "../utils/errors";
import { setFlashCookie } from "../utils/flash";
import { getSessionContext } from "./auth";

export type OrgResult =
  | { authorized: true; ctx: SessionContext; membership: Membership }
  | { authorized: false; response: Response };

/**
 * Require a minimum org role.
 *
 * Returns a discriminated union rather than requireAuth's nullable Response,
 * matching requireAdmin: the guard has to load the session and the membership
 * to decide at all, so handing them back saves the caller two round trips and
 * the window in which they could disagree.
 *
 * The teamsEnabled() check here is a backstop, not the primary one — every
 * controller method still opens with its own render404(), the way the
 * password-mode controllers do. Two owners of one concern is deliberate: the
 * line at the top of the method is what a fork reads, and the copy here means a
 * team route that forgets it fails closed rather than open.
 */
export const requireOrgRole = async (
  req: BunRequest,
  minimum: OrgRole,
): Promise<OrgResult> => {
  if (!teamsEnabled()) {
    return { authorized: false, response: render404() };
  }

  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated || !ctx.user) {
    // No flash: a signed-out visitor doesn't need to be told the surface
    // exists. Same as requireAdmin.
    return {
      authorized: false,
      response: new Response("", {
        status: 303,
        headers: { Location: "/login" },
      }),
    };
  }

  const membership = await getMembership(ctx.user.id);

  if (!membership) {
    return { authorized: false, response: denied(req, "You're not in a team") };
  }

  if (!atLeast(membership.role, minimum)) {
    // A redirect with a message rather than a 404: the member knows they are in
    // a team, so hiding the page teaches them nothing and produces a support
    // ticket instead.
    return {
      authorized: false,
      response: denied(req, "Only team admins can manage members"),
    };
  }

  return { authorized: true, ctx, membership };
};

const denied = (req: BunRequest, text: string): Response => {
  setFlashCookie(req, "message", { text, type: "error" });

  return new Response("", { status: 303, headers: { Location: "/" } });
};
