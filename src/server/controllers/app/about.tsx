import { About } from "../../templates/about";
import { render } from "../../utils/response";

export const about = {
  async index(): Promise<Response> {
    return await render(<About />);
  },
};
