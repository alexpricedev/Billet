import { describe, expect, mock, test } from "bun:test";

import { createBunRequest } from "../../test-utils/bun-request";
import { contact } from "./contact";
import { stack } from "./stack";

mock.module("../../middleware/auth", () => ({
  getSessionContext: () =>
    Promise.resolve({
      sessionId: null,
      user: null,
      isGuest: false,
      isAuthenticated: false,
      requiresSetCookie: false,
    }),
}));

mock.module("../../services/csrf", () => ({
  createCsrfToken: () => Promise.resolve("mock-csrf-token"),
}));

describe("Static Page Controllers", () => {
  describe("Stack Controller", () => {
    test("renders stack page", async () => {
      const req = createBunRequest("http://localhost:3000/stack");
      const response = await stack.index(req);
      const html = await response.text();

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("The Stack");
    });
  });

  describe("Contact Controller", () => {
    test("renders contact page", async () => {
      const response = await contact.index();
      const html = await response.text();

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Contact");
    });
  });
});
