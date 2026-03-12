import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import type { FormsState } from "../../templates/forms";
import { Forms } from "../../templates/forms";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<FormsState>();

export const forms = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let navCsrfToken: string | undefined;
    if (ctx.isAuthenticated && ctx.sessionId) {
      navCsrfToken = await createCsrfToken(
        ctx.sessionId,
        "POST",
        "/auth/logout",
      );
    }

    const state = getFlash(req);

    let formCsrfToken: string | null = null;
    if (ctx.sessionId) {
      formCsrfToken = await createCsrfToken(ctx.sessionId, "POST", "/forms");
    }

    return render(
      <Forms
        user={ctx.user}
        csrfToken={navCsrfToken}
        formCsrfToken={formCsrfToken}
        state={state}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (!ctx.sessionId) {
      return redirect("/forms");
    }

    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: "/forms",
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const formData = await req.formData();
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const message = formData.get("message") as string;

    if (!name || name.trim().length < 3) {
      return redirect("/forms");
    }

    setFlash(req, {
      state: "submission-success",
      name: name.trim(),
      email: email?.trim() || undefined,
      message: message?.trim() || undefined,
    });
    return redirect("/forms");
  },
};
