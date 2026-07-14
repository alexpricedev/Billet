import { buildLlmsTxt } from "../../services/llms-txt";

export const llmsTxt = {
  index(): Response {
    return new Response(buildLlmsTxt(), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
