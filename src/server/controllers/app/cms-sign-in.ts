import { handleCmsSignIn } from "@alexpricedev/billet-cms/sign-in";
import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { db } from "../../services/database";

/**
 * Where the CMS sends a signed-out editor. The CMS has no accounts of its own:
 * this checks the site session against `cms_identities` (admins, by default)
 * and hands them back with a single-use token. The path is fixed by the CMS
 * contract.
 */
export const cmsSignIn = {
  async index(req: BunRequest): Promise<Response> {
    return handleCmsSignIn(req, {
      sql: db,
      getUserId: async (request) =>
        (await getSessionContext(request as BunRequest)).user?.id ?? null,
    });
  },
};
