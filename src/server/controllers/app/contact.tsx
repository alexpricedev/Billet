import { Contact } from "../../templates/contact";
import { render } from "../../utils/response";

export const contact = {
  index(): Response {
    return render(<Contact />);
  },
};
