import type { BunRequest } from "bun";
import { getAuthContext, requireAuth } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { getSessionIdFromCookies } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import {
  createExample,
  deleteExample,
  getExamples,
} from "../../services/example";
import type { ExamplesState } from "../../templates/examples";
import { Examples } from "../../templates/examples";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { parseState, redirectWithState } = stateHelpers<ExamplesState>();

export const examples = {
  async index(req: BunRequest): Promise<Response> {
    // Get auth context and cookie session id
    const [auth, sessionId] = await Promise.all([
      getAuthContext(req),
      getSessionIdFromCookies(req.headers.get("cookie")),
    ]);

    const examples = await getExamples();

    if (!auth.isAuthenticated || !sessionId) {
      // If not authenticated, they just get examples
      return render(<Examples examples={examples} isAuthenticated={false} />);
    }

    const url = new URL(req.url);
    const state = parseState(url);

    let createCsrfTokenValue: string | null = null;
    const deleteCsrfTokens: Record<number, string> = {};

    // Create CSRF token for create action
    createCsrfTokenValue = await createCsrfToken(
      sessionId,
      "POST",
      "/examples",
    );

    // Create specific CSRF tokens for each example's delete endpoint
    for (const example of examples) {
      deleteCsrfTokens[example.id] = await createCsrfToken(
        sessionId,
        "POST",
        `/examples/${example.id}/delete`,
      );
    }

    return render(
      <Examples
        createCsrfToken={createCsrfTokenValue}
        deleteCsrfTokens={deleteCsrfTokens}
        examples={examples}
        isAuthenticated={auth.isAuthenticated}
        state={state}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
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
      return redirect(redirectWithState("/examples", {}));
    }

    // Happy path - successful form submission
    await createExample(name.trim());
    return redirect(
      redirectWithState("/examples", { state: "submission-success" }),
    );
  },

  async destroy<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    // Require authentication
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }

    // CSRF protection
    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: req.url, // Use the actual request path for CSRF validation
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const idParam = req.params.id;
    const id = Number.parseInt(idParam, 10);

    // Validate ID
    if (!idParam || Number.isNaN(id)) {
      return redirect("/examples");
    }

    // Attempt to delete the example
    const deleted = await deleteExample(id);

    if (!deleted) {
      return redirect(redirectWithState("/examples", {}));
    }

    return redirect(
      redirectWithState("/examples", { state: "deletion-success" }),
    );
  },
};
