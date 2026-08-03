import type { BunRequest } from "bun";

/**
 * Read named fields from a form-encoded body, trimmed, dropping empties.
 *
 * Safe to call after CSRF middleware has inspected the request: the middleware
 * only ever parses `req.clone()`, leaving this body unconsumed. Returns `{}`
 * rather than throwing when the body isn't form-encoded or is already spent,
 * so a recovery path degrades to "message shown, values lost".
 */
export const readFormValues = async (
  req: BunRequest,
  fields: readonly string[],
): Promise<Record<string, string>> => {
  const values: Record<string, string> = {};

  try {
    const formData = await req.formData();

    for (const field of fields) {
      const value = formData.get(field);
      if (typeof value !== "string") {
        continue;
      }

      const trimmed = value.trim();
      if (trimmed.length > 0) {
        values[field] = trimmed;
      }
    }
  } catch {
    return {};
  }

  return values;
};
