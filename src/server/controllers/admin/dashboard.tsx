import type { BunRequest } from "bun";
import { requireAdmin } from "../../middleware/admin";
import { AdminDashboard } from "../../templates/admin-dashboard";
import { render } from "../../utils/response";

export const admin = {
  async index(req: BunRequest): Promise<Response> {
    const result = await requireAdmin(req);
    if (!result.authorized) return result.response;

    return render(<AdminDashboard auth={result.ctx} />);
  },
};
