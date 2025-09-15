import { getAuthContext, requireAuth } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { getSessionIdFromCookies } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { createExample, getExamples } from "../../services/example";
import { Examples } from "../../templates/examples";
import { redirect, render } from "../../utils/response";

export const examples = {
  async index(req: Request): Promise<Response> {
    // Get auth context and generate CSRF token for authenticated users
    const auth = await getAuthContext(req);
    const url = new URL(req.url);
    const success = url.searchParams.get("success") === "true";

    let csrfToken: string | null = null;
    if (auth.isAuthenticated) {
      const cookieHeader = req.headers.get("cookie");
      const sessionId = getSessionIdFromCookies(cookieHeader);
      if (sessionId) {
        csrfToken = await createCsrfToken(sessionId, "POST", "/examples");
      }
    }

    const examples = await getExamples();
    return render(
      <Examples
        examples={examples}
        success={success}
        csrfToken={csrfToken}
        isAuthenticated={auth.isAuthenticated}
      />,
    );
  },

  async create(req: Request): Promise<Response> {
    // Require authentication
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }

    // CSRF protection
    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: "/examples",
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const formData = await req.formData();
    const name = formData.get("name") as string;

    // Early return for validation failures
    if (!name || name.trim().length < 2) {
      return redirect("/examples");
    }

    // Happy path - successful form submission
    await createExample(name.trim());
    return redirect("/examples?success=true");
  },
};
