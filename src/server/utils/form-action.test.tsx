import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";
import { findOrCreateUser } from "../services/auth";
import { createCsrfToken, TIME_WINDOW_MINUTES } from "../services/csrf";
import {
  createAuthenticatedSession,
  createGuestSession,
} from "../services/sessions";
import { createBunRequest, findSetCookie } from "../test-utils/bun-request";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData, randomEmail } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "../services/database";
import { type ActionGuard, formAction } from "./form-action";

type State = { state?: "expired" | "bad" | "done"; note?: string };

const ORIGIN = "http://localhost:3000";
const PATH = "/things/7/poke";

const post = (
  sessionId: string | null,
  token: string | null,
  options: { fragment?: boolean } = {},
) => {
  const body = new FormData();
  if (token) body.append("_csrf", token);
  return createBunRequest(
    `${ORIGIN}${PATH}`,
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        ...(sessionId ? { Cookie: `session_id=${sessionId}` } : {}),
        ...(options.fragment ? { [FRAGMENT_HEADER]: "1" } : {}),
      },
      body,
    },
    { id: "7" },
  );
};

const validToken = (sessionId: string) =>
  createCsrfToken(sessionId, "POST", PATH);

const staleToken = async (sessionId: string) => {
  setSystemTime(new Date(Date.now() - TIME_WINDOW_MINUTES * 3 * 60 * 1000));
  const token = await createCsrfToken(sessionId, "POST", PATH);
  setSystemTime();
  return token;
};

const userSession = async () => {
  const user = await findOrCreateUser(randomEmail());
  return createAuthenticatedSession(user.id);
};

describe("formAction", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterEach(() => {
    setSystemTime();
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  const handled = mock(async () => ({ flash: { state: "done" } as State }));
  const action = formAction<State>({
    redirectTo: "/things",
    onExpired: () => ({ state: "expired", note: "kept" }),
  });

  describe("outcomes on a plain post", () => {
    test("success redirects with the flash", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId));

      const response = await action(handled)(request);

      expect(handled).toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/things");
      expect(findSetCookie(request, "flash_state")).toContain("done");
    });

    test("success without a flash just redirects", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId));

      const response = await action(async () => ({}))(request);

      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toBeUndefined();
    });

    test("a rejection redirects with its flash", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId));

      const response = await action(async () => ({
        reject: 400,
        flash: { state: "bad" },
      }))(request);

      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain("bad");
    });

    test("a Response is sent as-is", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId));

      const response = await action(
        async () => new Response("custom", { status: 418 }),
      )(request);

      expect(response.status).toBe(418);
      expect(await response.text()).toBe("custom");
    });
  });

  describe("outcomes on a fragment request", () => {
    test("success renders the fragment with its status", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId), {
        fragment: true,
      });

      const response = await action(async () => ({
        flash: { state: "done" },
        fragment: <li>made</li>,
        status: 201,
      }))(request);

      expect(response.status).toBe(201);
      expect(response.headers.get("Content-Type")).toBe("text/html");
      expect(await response.text()).toBe("<li>made</li>");
      // The flash is for the redirect flow; a fragment never sets one.
      expect(findSetCookie(request, "flash_state")).toBeUndefined();
    });

    test("success with no fragment is a 204", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId), {
        fragment: true,
      });

      const response = await action(async () => ({
        flash: { state: "done" },
        fragment: null,
      }))(request);

      expect(response.status).toBe(204);
    });

    test("a rejection is the bare status", async () => {
      const sessionId = await createGuestSession();
      const request = post(sessionId, await validToken(sessionId), {
        fragment: true,
      });

      const response = await action(async () => ({
        reject: 404,
        flash: { state: "bad" },
      }))(request);

      expect(response.status).toBe(404);
      expect(findSetCookie(request, "flash_state")).toBeUndefined();
    });
  });

  describe("CSRF", () => {
    test("a missing or forged token fails hard on both paths", async () => {
      const sessionId = await createGuestSession();

      const missing = await action(handled)(post(sessionId, null));
      expect(missing.status).toBe(403);
      expect(await missing.text()).toBe("Invalid CSRF token");

      const forged = await action(handled)(
        post(sessionId, "invalid.token", { fragment: true }),
      );
      expect(forged.status).toBe(403);
      expect(forged.headers.get(CSRF_HEADER)).toBeNull();
    });

    test("a stale token on a plain post flashes onExpired and never runs the handler", async () => {
      const sessionId = await createGuestSession();
      const spy = mock(async () => ({}));
      const request = post(sessionId, await staleToken(sessionId));

      const response = await action(spy)(request);

      expect(spy).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain("expired");
      expect(findSetCookie(request, "flash_state")).toContain("kept");
    });

    test("a stale token on a fragment request is refreshed, and the fresh one works", async () => {
      const sessionId = await createGuestSession();
      const spy = mock(async () => ({ fragment: <li>ok</li> }));

      const refused = await action(spy)(
        post(sessionId, await staleToken(sessionId), { fragment: true }),
      );
      expect(spy).not.toHaveBeenCalled();
      expect(refused.status).toBe(403);
      const fresh = refused.headers.get(CSRF_HEADER);
      expect(fresh).toBeTruthy();

      const retried = await action(spy)(
        post(sessionId, fresh, { fragment: true }),
      );
      expect(retried.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("guards", () => {
    test('"user" sends a guest to login, or 401 on a fragment request', async () => {
      const guestId = await createGuestSession();
      const gated = formAction<State>({
        redirectTo: "/things",
        guard: "user",
        onExpired: () => ({ state: "expired" }),
      });

      const plain = await gated(handled)(
        post(guestId, await validToken(guestId)),
      );
      expect(plain.status).toBe(303);
      expect(plain.headers.get("Location")).toBe("/login");

      const fragment = await gated(handled)(
        post(guestId, await validToken(guestId), { fragment: true }),
      );
      expect(fragment.status).toBe(401);
    });

    test('"user" lets a signed-in user through with the context', async () => {
      const sessionId = await userSession();
      const gated = formAction<State>({
        redirectTo: "/things",
        guard: "user",
        onExpired: () => ({ state: "expired" }),
      });

      let seenUser = false;
      const response = await gated(async (_req, ctx) => {
        seenUser = ctx.isAuthenticated && ctx.user !== null;
        return {};
      })(post(sessionId, await validToken(sessionId)));

      expect(response.status).toBe(303);
      expect(seenUser).toBe(true);
    });

    test("a custom guard hands its value to the handler and its context to the wrapper", async () => {
      const sessionId = await createGuestSession();
      const guard: ActionGuard<{ label: string }> = async () => ({
        ok: true,
        value: { label: "from guard" },
      });
      const gated = formAction<State, { label: string }>({
        redirectTo: "/things",
        guard,
        onExpired: () => ({ state: "expired" }),
      });

      let seen = "";
      await gated(async (_req, _ctx, value) => {
        seen = value.label;
        return {};
      })(post(sessionId, await validToken(sessionId)));

      expect(seen).toBe("from guard");
    });

    test("a custom guard's redirect becomes 401 or 403 on a fragment request", async () => {
      const sessionId = await createGuestSession();
      const toLogin: ActionGuard<undefined> = async () => ({
        ok: false,
        response: new Response("", {
          status: 303,
          headers: { Location: "/login" },
        }),
      });
      const toHome: ActionGuard<undefined> = async () => ({
        ok: false,
        response: new Response("", { status: 303, headers: { Location: "/" } }),
      });
      const options = {
        redirectTo: "/things",
        onExpired: () => ({ state: "expired" as const }),
      };

      const plain = await formAction<State, undefined>({
        ...options,
        guard: toLogin,
      })(handled)(post(sessionId, null));
      expect(plain.status).toBe(303);

      const login = await formAction<State, undefined>({
        ...options,
        guard: toLogin,
      })(handled)(post(sessionId, null, { fragment: true }));
      expect(login.status).toBe(401);

      const denied = await formAction<State, undefined>({
        ...options,
        guard: toHome,
      })(handled)(post(sessionId, null, { fragment: true }));
      expect(denied.status).toBe(403);
    });

    test("a custom guard's non-redirect response passes through untouched", async () => {
      const sessionId = await createGuestSession();
      const gone: ActionGuard<undefined> = async () => ({
        ok: false,
        response: new Response("nope", { status: 404 }),
      });

      const response = await formAction<State, undefined>({
        redirectTo: "/things",
        guard: gone,
        onExpired: () => ({ state: "expired" }),
      })(handled)(post(sessionId, null, { fragment: true }));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("nope");
    });
  });
});
