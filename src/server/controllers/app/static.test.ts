import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { createBunRequest } from "../../test-utils/bun-request";
import { cleanupTestData } from "../../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { forms } from "./forms";
import { stack } from "./stack";

describe("Static Page Controllers", () => {
  beforeEach(async () => {
    await cleanupTestData(connection);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

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

  describe("Forms Controller", () => {
    test("renders forms page", async () => {
      const req = createBunRequest("http://localhost:3000/forms");
      const response = await forms.index(req);
      const html = await response.text();

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Form");
    });
  });
});
