import {
  forms,
  home,
  llmsTxt,
  projects,
  robotsTxt,
  securityTxt,
  sitemap,
  stack,
  webmanifest,
} from "../controllers/app";
import {
  account,
  callback,
  login,
  logout,
  passwordReset,
  signup,
  verify,
} from "../controllers/auth";
import { createRouteHandler } from "../utils/route-handler";

export const appRoutes = {
  "/": home.index,
  "/robots.txt": robotsTxt.index,
  "/site.webmanifest": webmanifest.index,
  "/sitemap.xml": sitemap.index,
  "/llms.txt": llmsTxt.index,
  "/.well-known/security.txt": securityTxt.index,
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
  "/signup": createRouteHandler({
    GET: signup.index,
    POST: signup.create,
  }),
  // Password-mode routes are registered unconditionally and 404 from inside the
  // controller when AUTH_MODE isn't "password", so the route table stays static
  // and testable rather than being rebuilt from the environment at import time.
  "/forgot-password": createRouteHandler({
    GET: passwordReset.index,
    POST: passwordReset.create,
  }),
  "/reset-password": createRouteHandler({
    GET: passwordReset.edit,
    POST: passwordReset.update,
  }),
  "/account": account.index,
  "/account/password": createRouteHandler({
    POST: account.updatePassword,
  }),
  "/auth/callback": callback.index,
  "/auth/verify": verify.index,
  "/auth/verify/resend": createRouteHandler({
    POST: verify.resend,
  }),
  "/auth/logout": createRouteHandler({
    POST: logout.create,
  }),
};
