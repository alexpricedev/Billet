import { describe, expect, test } from "bun:test";
import { SITE_NAME } from "../../services/seo";
import { webmanifest } from "./webmanifest";

describe("webmanifest Controller", () => {
  test("serves the manifest with the installable media type", () => {
    const response = webmanifest.index();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/manifest+json",
    );
  });

  test("names the app from SITE_NAME so a fork is never stuck as Billet", async () => {
    const manifest = await webmanifest.index().json();

    expect(manifest.name).toBe(SITE_NAME);
    expect(manifest.short_name).toBe(SITE_NAME);
  });

  test("declares the fields browsers need for installability", async () => {
    const manifest = await webmanifest.index().json();

    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  test("ships 192 and 512 icons plus a maskable variant", async () => {
    const manifest = await webmanifest.index().json();
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    const purposes = manifest.icons.map(
      (icon: { purpose?: string }) => icon.purpose,
    );

    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(purposes).toContain("maskable");
  });
});
