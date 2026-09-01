import type { BunRequest } from "bun";
import { getVisitorStats } from "../../services/analytics";
import { apiReadLimit } from "./request-guard";

export const statsApi = {
  index(req: BunRequest): Response {
    const limited = apiReadLimit(req);
    if (limited) return limited;

    return Response.json({ data: getVisitorStats() });
  },
};
