import { getVisitorStats } from "../../services/analytics";
import { Home } from "../../templates/home";
import { render } from "../../utils/response";

export const home = {
  index(req: Request): Response {
    const stats = getVisitorStats();
    return render(<Home method={req.method} stats={stats} />);
  },
};
