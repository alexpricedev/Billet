import { examples, forms, home, stack } from "../controllers/app";
import { callback, login, logout } from "../controllers/auth";
import { createRouteHandler } from "../utils/route-handler";

export const appRoutes = {
  "/": home.index,
  "/stack": stack.index,
  "/forms": forms.index,
  "/examples": createRouteHandler({
    GET: examples.index,
    POST: examples.create,
  }),
  "/examples/:id/delete": createRouteHandler({
    POST: examples.destroy<"/examples/:id/delete">,
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
