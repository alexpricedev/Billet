import { buildWebManifest } from "../../services/seo";

export const webmanifest = {
  index(): Response {
    return new Response(buildWebManifest(), {
      headers: {
        // The IANA-registered media type for a web app manifest. Browsers only
        // treat the file as installable when served with this type.
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
