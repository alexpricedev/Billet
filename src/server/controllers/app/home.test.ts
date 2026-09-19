import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createBunRequest } from "../../test-utils/bun-request";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData, withIndexingAllowed } from "../../test-utils/helpers";

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { home } from "./home";

describe("Home Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(connection);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("GET /", () => {
    test("renders home page wrapped in the layout", async () => {
      const request = createBunRequest("http://localhost:3000/", {
        method: "GET",
      });
      const response = await home.index(request);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(html).toContain('data-page="home"');
      expect(html).toContain("<main>");
    });

    // A public page carries no noindex of its own, so what it renders is the
    // site-wide switch. Both directions, because the default being closed is
    // the whole point and the open path is what a production host gets.
    test("stays out of the index until indexing is switched on", async () => {
      const request = createBunRequest("http://localhost:3000/", {
        method: "GET",
      });
      const html = await (await home.index(request)).text();

      expect(html).toContain('name="robots" content="noindex, nofollow"');
      // Structured data follows the tag: no point describing a page to a
      // crawler you are telling to ignore it.
      expect(html).not.toContain("application/ld+json");
    });

    test("is indexable with structured data once indexing is on", async () => {
      const request = createBunRequest("http://localhost:3000/", {
        method: "GET",
      });
      const html = await withIndexingAllowed(async () =>
        (await home.index(request)).text(),
      );

      expect(html).not.toContain('name="robots"');
      expect(html).toContain("application/ld+json");
    });
  });
});
