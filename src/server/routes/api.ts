import { examplesApi, statsApi } from "../controllers/api";
import { createRouteHandler } from "../utils/route-handler";

export const apiRoutes = {
  "/api/stats": statsApi.index,
  "/api/examples": createRouteHandler({
    GET: examplesApi.index,
    POST: examplesApi.create,
  }),
  "/api/examples/:id": createRouteHandler({
    GET: examplesApi.show,
    PUT: examplesApi.update,
    DELETE: examplesApi.destroy,
  }),
};
