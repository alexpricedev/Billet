import { projectsApi, statsApi } from "../controllers/api";
import { createRouteHandler } from "../utils/route-handler";

export const apiRoutes = {
  "/api/stats": statsApi.index,
  "/api/projects": createRouteHandler({
    GET: projectsApi.index,
    POST: projectsApi.create,
  }),
  "/api/projects/:id": createRouteHandler({
    GET: projectsApi.show,
    PUT: projectsApi.update,
    DELETE: projectsApi.destroy,
  }),
};
