import type { BunRequest } from "bun";
import type { JSX } from "preact";
import { getSessionContext, type SessionContext } from "../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../middleware/csrf";
import {
  emptyFragment,
  isFragmentRequest,
  refreshCsrfToken,
  renderFragment,
} from "./fragment";
import { redirect } from "./response";
import { stateHelpers } from "./state";

// Every POST controller used to open the same way — resolve the session, maybe
// require a user, check the CSRF token, branch three ways on failure — and
// close by producing two shapes of response: a redirect with a flash for a
// plain form post, a fragment for the same post sent by the client's
// `server.submit`. This wraps both ends, so a controller is left with the
// decision in the middle and can't forget stale-token recovery on either path.
//
// A plain post and a fragment request run the same handler. Only the response
// differs, and the handler describes the outcome rather than building it.

/**
 * Who may post. `"session"` is anyone with a session cookie, guests included;
 * `"user"` is `requireAuth`. A function is a custom guard — `requireOrgRole`
 * adapted, say — that either refuses with a Response or hands the handler a
 * value, and may carry the session context it already loaded so it isn't read
 * twice.
 */
export type ActionGuard<G> = (
  req: BunRequest,
) => Promise<
  | { ok: true; value: G; ctx?: SessionContext }
  | { ok: false; response: Response }
>;

export interface FormActionOptions<State, G = undefined> {
  // Where a plain post lands afterwards, whatever happened.
  redirectTo: string;
  guard?: "session" | "user" | ActionGuard<G>;
  // The flash for a stale-but-authentic token on a plain post. A fragment
  // request gets a fresh token instead — see `refreshCsrfToken`. The action
  // is never performed either way.
  onExpired: (req: BunRequest) => State | Promise<State>;
}

export type ActionOutcome<State> =
  // Sent as-is: an escape hatch for the odd case, not the usual return.
  | Response
  // Success. A plain post redirects with `flash`; a fragment request gets the
  // element (or a 204 when there is nothing to show, as after a delete).
  | { flash?: State; fragment?: JSX.Element | null; status?: number }
  // Refused — validation, not found. A plain post redirects, with `flash` if
  // there is something to say; a fragment request gets the bare status and
  // the client falls back to a plain post, which lands here again.
  | { reject: number; flash?: State };

export type ActionHandler<State, G> = (
  req: BunRequest,
  ctx: SessionContext,
  guard: G,
) => Promise<ActionOutcome<State>>;

// A guard that answers a fragment request with a redirect is answering a
// plain post, not a fetch. `server.submit` refuses redirects anyway; a status
// says why, so the client can tell "sign in" from "not allowed".
const refuseFragment = (response: Response): Response => {
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("Location") ?? "";
  return new Response(null, { status: location === "/login" ? 401 : 403 });
};

export const formAction =
  <State, G = undefined>(options: FormActionOptions<State, G>) =>
  (handler: ActionHandler<State, G>) =>
  async (req: BunRequest): Promise<Response> => {
    const fragment = isFragmentRequest(req);
    const { setFlash } = stateHelpers<State>();
    const guard = options.guard ?? "session";

    let ctx: SessionContext;
    let value: G;
    if (typeof guard === "function") {
      const result = await guard(req);
      if (!result.ok) {
        return fragment ? refuseFragment(result.response) : result.response;
      }
      value = result.value;
      ctx = result.ctx ?? (await getSessionContext(req));
    } else {
      ctx = await getSessionContext(req);
      value = undefined as G;
      if (guard === "user" && !ctx.isAuthenticated) {
        return fragment
          ? new Response(null, { status: 401 })
          : redirect("/login");
      }
    }

    if (!ctx.sessionId) {
      return fragment
        ? new Response(null, { status: 401 })
        : redirect(options.redirectTo);
    }

    // The token is bound to the method and the path it was minted for, so the
    // path is always the request's own.
    const path = new URL(req.url).pathname;
    const csrf = await checkCsrf(req, { method: "POST", path });
    if (!csrf.ok) {
      // Forged, missing or cross-origin: fail hard.
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      // Stale but authentic. Don't run the action.
      if (fragment) return refreshCsrfToken(ctx.sessionId, "POST", path);
      setFlash(req, await options.onExpired(req));
      return redirect(options.redirectTo);
    }

    const outcome = await handler(req, ctx, value);
    if (outcome instanceof Response) return outcome;

    if ("reject" in outcome) {
      if (fragment) return new Response(null, { status: outcome.reject });
      if (outcome.flash !== undefined) setFlash(req, outcome.flash);
      return redirect(options.redirectTo);
    }

    if (fragment) {
      return outcome.fragment
        ? renderFragment(outcome.fragment, { status: outcome.status })
        : emptyFragment();
    }
    if (outcome.flash !== undefined) setFlash(req, outcome.flash);
    return redirect(options.redirectTo);
  };
