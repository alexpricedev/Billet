import { statsApi, todosApi } from "../controllers/api";
import { createApiRouteHandler } from "../utils/route-handler";

// Every API route goes through `createApiRouteHandler`, including the read-only
// ones: a bare handler in this map answers *every* method, so `/api/stats` used
// to serve its payload to a DELETE.
export const apiRoutes = {
  "/api/stats": createApiRouteHandler({
    GET: statsApi.index,
  }),
  "/api/todos": createApiRouteHandler({
    GET: todosApi.index,
    POST: todosApi.create,
  }),
  "/api/todos/:id": createApiRouteHandler({
    GET: todosApi.show,
    PUT: todosApi.update,
    DELETE: todosApi.destroy,
  }),
};
