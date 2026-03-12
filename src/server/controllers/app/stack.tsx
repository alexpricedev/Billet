import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { createCsrfToken } from "../../services/csrf";
import { Stack } from "../../templates/stack";
import { render } from "../../utils/response";

export const stack = {
  async index(req: BunRequest): Promise<Response> {
    const { user, sessionId } = await getSessionContext(req);
    const csrfToken = sessionId
      ? await createCsrfToken(sessionId, "POST", "/auth/logout")
      : undefined;
    return render(<Stack user={user ?? null} csrfToken={csrfToken} />);
  },
};
