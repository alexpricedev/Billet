import { forms, home, projects, stack } from "../controllers/app";
import { callback, login, logout } from "../controllers/auth";
import { createRouteHandler } from "../utils/route-handler";

export const appRoutes = {
  "/": home.index,
  "/stack": stack.index,
  "/forms": createRouteHandler({
    GET: forms.index,
    POST: forms.create,
  }),
  "/projects": createRouteHandler({
    GET: projects.index,
    POST: projects.create,
  }),
  "/projects/:id/delete": createRouteHandler({
    POST: projects.destroy<"/projects/:id/delete">,
  }),
  "/login": createRouteHandler({
    GET: login.index,
    POST: login.create,
  }),
  "/auth/callback": callback.index,
  "/auth/logout": createRouteHandler({
    POST: logout.create,
  }),
};
