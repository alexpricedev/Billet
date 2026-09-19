import type { SessionContext } from "../middleware/auth";
import { createCsrfToken } from "../services/csrf";

// Token minting for the GET side of a page. A token is bound to one method and
// path, so a list page needs one per form: the create form, each row's
// actions, the nav's logout. Binding the session once removes the `if
// (ctx.sessionId)` guard from every call, and `forEach` turns a per-row loop
// into one await. Templates already treat a null token as "render the form
// anyway"; the post then fails the CSRF check, which is right for a visitor
// with no session.
export const csrfTokens = (ctx: SessionContext) => {
  const mint = async (path: string, method = "POST"): Promise<string | null> =>
    ctx.sessionId ? createCsrfToken(ctx.sessionId, method, path) : null;

  return {
    /** A token for anyone with a session, guests included. */
    for: mint,

    /** A token for signed-in users only; null for everyone else. */
    forUser: async (path: string): Promise<string | null> =>
      ctx.isAuthenticated ? mint(path) : null,

    /**
     * One token per row, keyed by id. Rows whose token can't be minted (no
     * session, or `usersOnly` and a guest) are left out, so a template can
     * test `tokens[id]` to decide whether to render the form.
     */
    forEach: async <T extends { id: number | string }>(
      rows: T[],
      path: (row: T) => string,
      options: { usersOnly?: boolean } = {},
    ): Promise<Record<T["id"], string>> => {
      const tokens = {} as Record<T["id"], string>;
      if (options.usersOnly && !ctx.isAuthenticated) return tokens;
      await Promise.all(
        rows.map(async (row) => {
          const token = await mint(path(row));
          if (token) tokens[row.id as T["id"]] = token;
        }),
      );
      return tokens;
    },

    /** The nav's logout token — signed-in users only, undefined otherwise. */
    nav: async (): Promise<string | undefined> =>
      ctx.isAuthenticated
        ? ((await mint("/auth/logout")) ?? undefined)
        : undefined,
  };
};
