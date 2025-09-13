import { redirectIfAuthenticated } from "../../middleware/auth";
import { createMagicLink } from "../../services/auth";
import { Login } from "../../templates/login";
import { redirect, render } from "../../utils/response";

export const login = {
  async index(req: Request): Promise<Response> {
    // Redirect if already authenticated
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

    // Validate email
    if (!email || !email.includes("@")) {
      return redirect("/login?error=Invalid email address");
    }

    try {
      const { rawToken } = await createMagicLink(email.toLowerCase().trim());

      // In a real app, you would send this via email
      // For now, we'll just log it to the console for testing
      const magicLink = `http://localhost:3000/auth/callback?token=${rawToken}`;
      console.log(`🔗 Magic link for ${email}: ${magicLink}`);

      return redirect("/login?sent=true");
    } catch (error) {
      console.error("Error creating magic link:", error);
      return redirect("/login?error=Something went wrong. Please try again.");
    }
  },
};
