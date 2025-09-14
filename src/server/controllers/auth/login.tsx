import { redirectIfAuthenticated } from "../../middleware/auth";
import { createMagicLink } from "../../services/auth";
import { Login } from "../../templates/login";
import { redirect, render } from "../../utils/response";

export const login = {
  async index(req: Request): Promise<Response> {
    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    const url = new URL(req.url);
    const sent = url.searchParams.get("sent") === "true";
    const error = url.searchParams.get("error");

    return render(<Login sent={sent} error={error} />);
  },

  async create(req: Request): Promise<Response> {
    const formData = await req.formData();
    const email = formData.get("email") as string;

    if (!email || !email.includes("@")) {
      return redirect("/login?error=Invalid email address");
    }

    try {
      await createMagicLink(email.toLowerCase().trim());

      // TODO: Send magic link via email service
      // For development, magic link is generated and should be sent via email

      return redirect("/login?sent=true");
    } catch {
      return redirect("/login?error=Something went wrong. Please try again.");
    }
  },
};
