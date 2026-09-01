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
import { invite, team, teamInvites, teamMembers } from "../controllers/team";
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
    POST: projects.destroy,
  }),
  "/login": createRouteHandler({
    GET: login.index,
    POST: login.create,
  }),
  "/signup": createRouteHandler({
    GET: signup.index,
    POST: signup.create,
  }),
  // Password-mode and team routes are registered unconditionally and 404 from
  // inside the controller when AUTH_MODE isn't "password" or TEAMS_ENABLED
  // isn't "true", so the route table stays static and testable rather than
  // being rebuilt from the environment at import time.
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
  // Both of these arrive as a link in an email, so both render a confirm step
  // on GET and spend the token on POST: a single-use token a mail scanner can
  // burn by fetching the link is a token the recipient never gets to use.
  "/auth/callback": createRouteHandler({
    GET: callback.index,
    POST: callback.create,
  }),
  "/auth/verify": createRouteHandler({
    GET: verify.index,
    POST: verify.create,
  }),
  "/auth/verify/resend": createRouteHandler({
    POST: verify.resend,
  }),
  "/auth/logout": createRouteHandler({
    POST: logout.create,
  }),
  "/team": createRouteHandler({
    GET: team.index,
    POST: team.create,
  }),
  "/team/invites": createRouteHandler({
    POST: teamInvites.create,
  }),
  "/team/invites/:id/revoke": createRouteHandler({
    POST: teamInvites.destroy,
  }),
  "/team/members/:id/role": createRouteHandler({
    POST: teamMembers.updateRole,
  }),
  "/team/members/:id/remove": createRouteHandler({
    POST: teamMembers.destroy,
  }),
  // Outside /team on purpose: the visitor spending an invite has no membership
  // yet, so this must not sit under a path whose every other entry is behind
  // the org guard.
  "/invites/accept": createRouteHandler({
    GET: invite.index,
    POST: invite.create,
  }),
};
