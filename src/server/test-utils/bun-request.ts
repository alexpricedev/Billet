import type { BunRequest } from "bun";

/**
 * Creates a properly typed BunRequest for testing purposes
 * @param url - The request URL
 * @param options - Standard Request options
 * @param params - Route parameters (e.g., { id: "42" })
 * @returns A BunRequest with the params property set
 */
export const createBunRequest = <T extends string = string>(
  url: string,
  options: RequestInit = {},
  params: Record<string, string> = {},
): BunRequest<T> => {
  const req = new Request(url, options) as BunRequest<T>;
  Object.defineProperty(req, "params", {
    value: params,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return req;
};
