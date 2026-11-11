import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { BunRequest } from "bun";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData } from "../../test-utils/helpers";

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "../../services/database";
import { type DevLoginAccount, devLoginToken } from "../../services/dev-login";
import {
  createGuestSession,
  getSessionContextFromDB,
} from "../../services/sessions";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { devLogin } from "./dev-login";

const ORIGIN = process.env.APP_URL as string;
const NODE_ENV = process.env.NODE_ENV;

const follow = async (
  query: Record<string, string>,
  sessionId?: string,
): Promise<{ req: BunRequest; res: Response }> => {
  const req = createBunRequest(
    `${ORIGIN}/dev/login?${new URLSearchParams(query)}`,
    {
      method: "GET",
      headers: sessionId ? { cookie: `session_id=${sessionId}` } : {},
    },
  );
  return { req, res: await devLogin.index(req) };
};

/** The link as the startup line prints it. */
const followLink = (
  account: DevLoginAccount,
  extra: Record<string, string> = {},
  sessionId?: string,
) =>
  follow({ as: account, token: devLoginToken(account), ...extra }, sessionId);

const sessionFrom = (req: BunRequest): string => {
  const match = findSetCookie(req, "session_id")?.match(/session_id=([^;]+)/);
  if (!match) throw new Error("no session cookie was set");
  return match[1];
};

const sessionCount = async (): Promise<number> => {
  const [row] = await db`SELECT count(*)::int AS count FROM sessions`;
  return row.count;
};

describe("Dev Login Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
    await db`
      INSERT INTO users (email, role)
      VALUES ('admin@example.com', 'admin'), ('alice@example.com', 'user')
    `;
    process.env.DEV_LOGIN = "true";
  });

  afterEach(() => {
    process.env.DEV_LOGIN = "false";
    process.env.NODE_ENV = NODE_ENV;
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("when it is not on", () => {
    test("404s with the flag off, even for a correct link", async () => {
      process.env.DEV_LOGIN = "false";

      const { req, res } = await followLink("admin");

      expect(res.status).toBe(404);
      expect(findSetCookie(req, "session_id")).toBeUndefined();
      expect(await sessionCount()).toBe(0);
    });

    test("404s in production, even with the flag on", async () => {
      process.env.NODE_ENV = "production";

      const { res } = await followLink("admin");

      expect(res.status).toBe(404);
      expect(await sessionCount()).toBe(0);
    });
  });

  describe("a link that isn't the printed one", () => {
    test.each([
      ["no token", { as: "admin" }],
      ["a wrong token", { as: "admin", token: "nope" }],
      ["no account", { token: devLoginToken("admin") }],
      ["an unknown account", { as: "owner", token: devLoginToken("admin") }],
      // The account is part of what the token signs, so the admin link can't
      // be made out of the user one by editing `as`.
      [
        "the other account's token",
        { as: "admin", token: devLoginToken("user") },
      ],
      // The address is never read from the URL.
      [
        "an address in place of an account",
        { as: "admin@example.com", token: devLoginToken("admin") },
      ],
    ] as [string, Record<string, string>][])(
      "%s is a 404",
      async (_, query) => {
        const { req, res } = await follow(query);

        expect(res.status).toBe(404);
        expect(findSetCookie(req, "session_id")).toBeUndefined();
        expect(await sessionCount()).toBe(0);
      },
    );
  });

  describe("the printed link", () => {
    test.each([
      ["admin", "admin@example.com"],
      ["user", "alice@example.com"],
    ] as [DevLoginAccount, string][])(
      "%s signs in as %s",
      async (account, email) => {
        const { req, res } = await followLink(account);

        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");

        const ctx = await getSessionContextFromDB(sessionFrom(req));
        expect(ctx?.user?.email).toBe(email);
        expect(ctx?.user?.role).toBe(account);
      },
    );

    // Switching account is the second link's job, and it must not leave the
    // first account's session behind.
    test("following the other link replaces the session", async () => {
      const first = await followLink("admin");
      const adminSession = sessionFrom(first.req);

      const second = await followLink("user", {}, adminSession);
      const ctx = await getSessionContextFromDB(sessionFrom(second.req));

      expect(ctx?.user?.email).toBe("alice@example.com");
      expect(await getSessionContextFromDB(adminSession)).toBeNull();
      expect(await sessionCount()).toBe(1);
    });

    test("the guest session the visitor arrived with is deleted", async () => {
      const guest = await createGuestSession();

      const { req } = await followLink("admin", {}, guest);

      expect(sessionFrom(req)).not.toBe(guest);
      expect(await getSessionContextFromDB(guest)).toBeNull();
    });

    test("lands on a same-origin next path", async () => {
      const { res } = await followLink("admin", { next: "/admin" });

      expect(res.headers.get("location")).toBe("/admin");
    });

    test("ignores a next that leaves the site", async () => {
      const { res } = await followLink("admin", {
        next: "https://evil.example/",
      });

      expect(res.headers.get("location")).toBe("/");
    });
  });

  describe("an account that isn't what the link promises", () => {
    // Creating a platform admin on demand is the hole seedIfEmpty avoids.
    test("a missing account is not created", async () => {
      await db`DELETE FROM users WHERE email = 'admin@example.com'`;

      const { req, res } = await followLink("admin");

      expect(res.status).toBe(303);
      expect(decodeURIComponent(res.headers.get("location") ?? "")).toBe(
        "/login?error=Dev sign-in unavailable: admin@example.com does not exist in this database.",
      );
      expect(findSetCookie(req, "session_id")).toBeUndefined();

      const users = await db`
        SELECT 1 FROM users WHERE email = 'admin@example.com'
      `;
      expect(users.length).toBe(0);
    });

    test("the user link refuses once alice has been made an admin", async () => {
      await db`UPDATE users SET role = 'admin' WHERE email = 'alice@example.com'`;

      const { req, res } = await followLink("user");

      expect(decodeURIComponent(res.headers.get("location") ?? "")).toBe(
        "/login?error=Dev sign-in unavailable: alice@example.com is no longer a platform user.",
      );
      expect(findSetCookie(req, "session_id")).toBeUndefined();
      expect(await sessionCount()).toBe(0);
    });

    test("the admin link refuses once the admin has been demoted", async () => {
      await db`UPDATE users SET role = 'user' WHERE email = 'admin@example.com'`;

      const { res } = await followLink("admin");

      expect(res.headers.get("location")).toContain("/login?error=");
      expect(await sessionCount()).toBe(0);
    });
  });
});
