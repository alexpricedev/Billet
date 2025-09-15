import { redirectIfAuthenticated } from "../../middleware/auth";
import { createMagicLink } from "../../services/auth";
import type { LoginState } from "../../templates/login";
import { Login } from "../../templates/login";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { parseState, redirectWithState } = stateHelpers<LoginState>();

export const login = {
  async index(req: Request): Promise<Response> {
    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    const url = new URL(req.url);
    const state = parseState(url);

    return render(<Login state={state} />);
  },

  async create(req: Request): Promise<Response> {
    const formData = await req.formData();
    const email = formData.get("email") as string;

    if (!email || !email.includes("@")) {
      return redirect(
        redirectWithState("/login", {
          state: "validation-error",
          error: "Invalid email address",
        }),
      );
    }

    try {
      const { rawToken } = await createMagicLink(email.toLowerCase().trim());

      // TODO: Send magic link via email service
      // For development, print magic link to console
      if (process.env.NODE_ENV !== "production") {
        const url = new URL(req.url);
        const magicLinkUrl = `${url.protocol}//${url.host}/auth/callback?token=${rawToken}`;
        // eslint-disable-next-line no-console
        console.log(`🔗 Magic link for ${email}: ${magicLinkUrl}`);
      }

      return redirect(redirectWithState("/login", { state: "email-sent" }));
    } catch {
      return redirect(
        redirectWithState("/login", {
          state: "validation-error",
          error: "Something went wrong. Please try again.",
        }),
      );
    }
  },
};
