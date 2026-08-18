import {
  forms,
  home,
  llmsTxt,
  organisations,
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
  invites,
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
  // Organisations-mode routes are registered unconditionally for the same
  // reason as the password-mode ones above: the controller decides.
  "/organisation": organisations.index,
  "/organisation/invites": createRouteHandler({
    POST: organisations.invite,
  }),
  "/organisation/invites/:id/delete": createRouteHandler({
    POST: organisations.revokeInvite<"/organisation/invites/:id/delete">,
  }),
  "/invites/accept": createRouteHandler({
    GET: invites.edit,
    POST: invites.update,
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
