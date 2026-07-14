import { describe, expect, test } from "bun:test";
import { SITE_NAME } from "../../services/seo";
import { llmsTxt } from "./llms-txt";

describe("llms.txt Controller", () => {
  test("serves markdown with the correct content type", async () => {
    const response = llmsTxt.index();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(body).toStartWith(`# ${SITE_NAME}`);
  });

  test("sets a cache-control header", () => {
    const response = llmsTxt.index();

    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
