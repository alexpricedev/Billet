import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../../test-utils/helpers";
import { createMockRequest } from "../../test-utils/setup";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const testDb = new SQL(process.env.DATABASE_URL);
mock.module("../../services/database", () => ({
  db: testDb,
}));

import { login } from "./login";

const db = testDb;

describe("Login Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(testDb);
  });

  describe("GET /login", () => {
    test("renders login page for unauthenticated user", async () => {
      const request = createMockRequest("http://localhost:3000/login", "GET");
      const response = await login.index(request);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(html).toContain("Sign in to your account");
      expect(html).toContain('name="email"');
      expect(html).toContain("Send magic link");
    });

    test("shows success message when state=email-sent", async () => {
      const request = createMockRequest(
        "http://localhost:3000/login?state=email-sent",
        "GET",
      );
      const response = await login.index(request);
      const html = await response.text();

      expect(html).toContain("Check your email!");
      expect(html).toContain("We&#x27;ve sent you a magic link");
    });

    test("shows error message when error is provided", async () => {
      const request = createMockRequest(
        "http://localhost:3000/login?state=validation-error&error=Invalid%20email",
        "GET",
      );
      const response = await login.index(request);
      const html = await response.text();

      expect(html).toContain("Invalid email");
    });

    test("redirects authenticated user to home", async () => {
      // Mock the redirectIfAuthenticated function to return a redirect response
      const mockRedirectIfAuthenticated = mock(
        () =>
          new Response("", {
            status: 303,
            headers: { Location: "/" },
          }),
      );

      // Temporarily mock the auth middleware
      mock.module("../../middleware/auth", () => ({
        redirectIfAuthenticated: mockRedirectIfAuthenticated,
      }));

      // Re-import login after mocking
      const { login: mockedLogin } = await import("./login");

      const request = new Request("http://localhost:3000/login", {
        method: "GET",
        headers: {
          cookie: "session_id=valid-session-id",
        },
      });

      const response = await mockedLogin.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(mockRedirectIfAuthenticated).toHaveBeenCalled();
    });
  });

  describe("POST /login", () => {
    test("creates magic link for valid email", async () => {
      const formData = new FormData();
      formData.append("email", "test@example.com");

      const request = new Request("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login?state=email-sent");

      // Verify user was created
      const users =
        await db`SELECT id, email FROM users WHERE email = 'test@example.com'`;
      expect(users).toHaveLength(1);

      // Verify magic link token was created
      const tokens = await db`
        SELECT id, user_id, type, expires_at 
        FROM user_tokens 
        WHERE user_id = ${(users[0] as any).id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(1);
    });

    test("normalizes email to lowercase", async () => {
      const formData = new FormData();
      formData.append("email", "Test@Example.COM");

      const request = new Request("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      await login.create(request);

      // Verify user was created with lowercase email
      const users =
        await db`SELECT email FROM users WHERE email = 'test@example.com'`;
      expect(users).toHaveLength(1);
    });

    test("redirects with error for invalid email", async () => {
      const formData = new FormData();
      formData.append("email", "not-an-email");

      const request = new Request("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/login?state=validation-error&error=Invalid+email+address",
      );
    });

    test("redirects with error for missing email", async () => {
      const formData = new FormData();

      const request = new Request("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/login?state=validation-error&error=Invalid+email+address",
      );
    });

    test("reuses existing user for same email", async () => {
      // Create user first using proper UUID
      const { randomUUID } = await import("node:crypto");
      const userId = randomUUID();
      const user = await db`
        INSERT INTO users (id, email) VALUES (${userId}, 'existing@example.com') RETURNING id
      `;

      const formData = new FormData();
      formData.append("email", "existing@example.com");

      const request = new Request("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      await login.create(request);

      // Should still be only one user
      const users =
        await db`SELECT id FROM users WHERE email = 'existing@example.com'`;
      expect(users).toHaveLength(1);
      expect((users[0] as any).id).toBe((user[0] as any).id);

      // But should have created a new token
      const tokens = await db`
        SELECT id FROM user_tokens 
        WHERE user_id = ${(user[0] as any).id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(1);
    });
  });
});
