import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import type { FormsState } from "../../templates/forms";
import { Forms } from "../../templates/forms";
import { readFormValues } from "../../utils/form-data";
import { redirect, render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<FormsState>();

const FORM_FIELDS = ["name", "email", "message"] as const;

// Ordered longest-first: sacrifice the message before the short fields when
// the preserved values don't fit the flash cookie.
const TRIMMABLE_FIELDS = ["message", "name", "email"] as const;

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

    const csrf = await checkCsrf(req, { method: "POST", path: "/forms" });
    if (!csrf.ok) {
      // Forged, missing or cross-origin: fail hard, exactly as before.
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }

      // Stale but authentic. Don't run the action - hand the work back with a
      // fresh token so the user can resubmit instead of losing what they typed.
      const stale = await readFormValues(req, FORM_FIELDS);
      setFlash(
        req,
        fitFlashState<FormsState>(
          {
            state: "csrf-expired",
            name: stale.name,
            email: stale.email,
            message: stale.message,
          },
          TRIMMABLE_FIELDS,
        ),
      );
      return redirect("/forms");
    }

    const { name, email, message } = await readFormValues(req, FORM_FIELDS);

    if (!name || name.length < 3) {
      setFlash(
        req,
        fitFlashState<FormsState>(
          { state: "validation-error", name, email, message },
          TRIMMABLE_FIELDS,
        ),
      );
      return redirect("/forms");
    }

    setFlash(
      req,
      fitFlashState<FormsState>(
        { state: "submission-success", name, email, message },
        TRIMMABLE_FIELDS,
      ),
    );
    return redirect("/forms");
  },
};
