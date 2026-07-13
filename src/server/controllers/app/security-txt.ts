import { buildSecurityTxt } from "../../services/security-txt";

export const securityTxt = {
  index(): Response {
    return new Response(buildSecurityTxt(), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
