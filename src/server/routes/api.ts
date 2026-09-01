import { projectsApi, statsApi } from "../controllers/api";
import { createApiRouteHandler } from "../utils/route-handler";

// Every API route goes through `createApiRouteHandler`, including the read-only
// ones: a bare handler in this map answers *every* method, so `/api/stats` used
// to serve its payload to a DELETE.
export const apiRoutes = {
  "/api/stats": createApiRouteHandler({
    GET: statsApi.index,
  }),
  "/api/projects": createApiRouteHandler({
    GET: projectsApi.index,
    POST: projectsApi.create,
  }),
  "/api/projects/:id": createApiRouteHandler({
    GET: projectsApi.show,
    PUT: projectsApi.update,
    DELETE: projectsApi.destroy,
  }),
};
