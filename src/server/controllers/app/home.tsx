import { getAuthContext } from "../../middleware/auth";
import { getVisitorStats } from "../../services/analytics";
import { Home } from "../../templates/home";
import { render } from "../../utils/response";

export const home = {
  async index(req: Request): Promise<Response> {
    const [stats, auth] = await Promise.all([
      getVisitorStats(),
      getAuthContext(req),
    ]);

    return render(<Home method={req.method} stats={stats} auth={auth} />);
  },
};
