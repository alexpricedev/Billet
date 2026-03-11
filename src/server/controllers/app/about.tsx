import { About } from "../../templates/about";
import { render } from "../../utils/response";

export const about = {
  index(): Response {
    return render(<About />);
  },
};
