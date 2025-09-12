import { about, contact, examples, home } from "../controllers/app";
import { createRouteHandler } from "../utils/route-handler";

export const appRoutes = {
  "/": home.index,
  "/about": about.index,
  "/contact": contact.index,
  "/examples": createRouteHandler({
    GET: examples.index,
    POST: examples.create,
  }),
};
