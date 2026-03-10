import { Contact } from "../../templates/contact";
import { render } from "../../utils/response";

export const contact = {
  async index(): Promise<Response> {
    return await render(<Contact />);
  },
};
