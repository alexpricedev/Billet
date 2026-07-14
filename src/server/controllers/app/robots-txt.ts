import { buildRobotsTxt } from "../../services/seo";

export const robotsTxt = {
  index(): Response {
    return new Response(buildRobotsTxt(), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
