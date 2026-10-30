import {
  applyPreview,
  getPreviewAccess,
} from "@alexpricedev/billet-cms/server";
import type { BunRequest } from "bun";
import { getHomeHero } from "../../cms/home-hero";
import { getSessionContext } from "../../middleware/auth";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import { setSessionCookie } from "../../services/sessions";
import { Home } from "../../templates/home";
import { type FlashMessage, getFlashCookie } from "../../utils/flash";
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
    const message = getFlashCookie<Partial<FlashMessage>>(req, "message");

    // A CMS preview link lands here with ?cms_preview=; without a valid token
    // this is null and the page reads the published hero, untouched.
    const preview = await getPreviewAccess(db, req);
    const hero = await getHomeHero(preview);

    return applyPreview(
      render(
        <Home
          user={ctx.user}
          csrfToken={csrfToken}
          message={message.text ? (message as FlashMessage) : undefined}
          hero={hero}
        />,
      ),
      preview,
    );
  },
};
