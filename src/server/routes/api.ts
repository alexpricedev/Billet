import { getVisitorStats } from "../services/analytics";

export const apiRoutes = {
  "/api/stats": () => {
    return Response.json(getVisitorStats());
  },
};
