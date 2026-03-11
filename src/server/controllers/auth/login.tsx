import type { BunRequest } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import { createMagicLink } from "../../services/auth";
import { getEmailService } from "../../services/email";
import type { LoginState } from "../../templates/login";
import { Login } from "../../templates/login";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<LoginState>();

export const login = {
  async index(req: BunRequest): Promise<Response> {
    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    const state = getFlash(req);

    return render(<Login state={state} />);
  },

  async create(req: BunRequest): Promise<Response> {
    const formData = await req.formData();
    const email = formData.get("email") as string;

    if (!email || !email.includes("@")) {
      setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
      });
      return redirect("/login");
    }

    try {
      const { user, rawToken } = await createMagicLink(
        email.toLowerCase().trim(),
      );

      const url = new URL(req.url);
      const magicLinkUrl = `${url.protocol}//${url.host}/auth/callback?token=${rawToken}`;

      const emailService = getEmailService();
      await emailService.sendMagicLink({
        to: { email: user.email },
        magicLinkUrl,
        expiryMinutes: 15,
      });

      setFlash(req, { state: "email-sent" });
      return redirect("/login");
    } catch {
      setFlash(req, {
        state: "validation-error",
        error: "Something went wrong. Please try again.",
      });
      return redirect("/login");
    }
  },
};
