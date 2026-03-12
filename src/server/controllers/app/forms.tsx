import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { createCsrfToken } from "../../services/csrf";
import { Forms } from "../../templates/forms";
import { render } from "../../utils/response";

export const forms = {
  async index(req: BunRequest): Promise<Response> {
    const { user, sessionId } = await getSessionContext(req);
    const csrfToken = sessionId
      ? await createCsrfToken(sessionId, "POST", "/auth/logout")
      : undefined;
    return render(<Forms user={user ?? null} csrfToken={csrfToken} />);
  },
};
