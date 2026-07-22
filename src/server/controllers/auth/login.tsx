import type { BunRequest } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rate-limit";
import { createMagicLink } from "../../services/auth";
import {
  captchaEnabled,
  HONEYPOT_FIELD,
  issueChallenge,
  verifyCaptcha,
} from "../../services/captcha";
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
    const challenge = captchaEnabled() ? issueChallenge() : null;

    return render(<Login state={state} challenge={challenge} />);
  },

  async create(req: BunRequest): Promise<Response> {
    // Layered bot defense, cheapest guard first — each short-circuits.
    // 1. Rate limit: reject floods before parsing the body. Tighter than the
    //    default (10/5s) since every request here can send an email.
    const limited = rateLimit(req, 5, 60_000);
    if (limited) return limited;

    const formData = await req.formData();

    // 2. Honeypot: a filled hidden field means a bot. Feign success — create
    //    nothing, send nothing — so the bot has no signal to adapt to.
    if (formData.get(HONEYPOT_FIELD)) {
      setFlash(req, { state: "email-sent" });
      return redirect("/login");
    }

    // 3. Captcha: no-op (passes) when disabled; otherwise the proof of work must
    //    verify. This is the real defense against automated submissions.
    if (!verifyCaptcha(formData.get("captcha_solution") as string | null)) {
      setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
      });
      return redirect("/login");
    }

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
