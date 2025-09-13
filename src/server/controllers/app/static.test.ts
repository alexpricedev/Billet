import { describe, expect, test } from "bun:test";

import { about } from "./about";
import { contact } from "./contact";

describe("Static Page Controllers", () => {
  describe("About Controller", () => {
    test("renders about page", async () => {
      const response = about.index();
      const html = await response.text();

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("text/html");

      // Test actual HTML content
      expect(html).toContain("About");
    });
  });

  describe("Contact Controller", () => {
    test("renders contact page", async () => {
      const response = contact.index();
      const html = await response.text();

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("text/html");

      // Test actual HTML content
      expect(html).toContain("Contact");
    });
  });
});
