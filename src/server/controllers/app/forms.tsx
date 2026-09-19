import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { setSessionCookie } from "../../services/sessions";
import type { FormsState } from "../../templates/forms";
import { Forms } from "../../templates/forms";
import { csrfTokens } from "../../utils/csrf-tokens";
import { formAction } from "../../utils/form-action";
import { readFormValues } from "../../utils/form-data";
import { render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash } = stateHelpers<FormsState>();

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

    const tokens = csrfTokens(ctx);
    return render(
      <Forms
        user={ctx.user}
        csrfToken={await tokens.nav()}
        formCsrfToken={await tokens.for("/forms")}
        state={getFlash(req)}
      />,
    );
  },

  create: formAction<FormsState>({
    redirectTo: "/forms",
    // Stale but authentic: hand the work back with a fresh token so the user
    // can resubmit instead of losing what they typed.
    onExpired: async (req) => {
      const { name, email, message } = await readFormValues(req, FORM_FIELDS);
      return fitFlashState<FormsState>(
        { state: "csrf-expired", name, email, message },
        TRIMMABLE_FIELDS,
      );
    },
  })(async (req) => {
    const { name, email, message } = await readFormValues(req, FORM_FIELDS);

    if (!name || name.length < 3) {
      return {
        reject: 400,
        flash: fitFlashState<FormsState>(
          { state: "validation-error", name, email, message },
          TRIMMABLE_FIELDS,
        ),
      };
    }

    return {
      flash: fitFlashState<FormsState>(
        { state: "submission-success", name, email, message },
        TRIMMABLE_FIELDS,
      ),
    };
  }),
};
