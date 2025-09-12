import { getVisitorStats } from "../../services/analytics";

export const statsApi = {
  index(): Response {
    return Response.json(getVisitorStats());
  },
};
