import type { BunRequest } from "bun";

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  path?: string;
  maxAge?: number;
  domain?: string;
};

/**
 * Creates a properly typed BunRequest for testing purposes with cookies API
 * @param url - The request URL
 * @param options - Standard Request options
 * @param params - Route parameters (e.g., { id: "42" })
 * @returns A BunRequest with the params and cookies properties set
 */
export const createBunRequest = <T extends string = string>(
  url: string,
  options: RequestInit = {},
  params: Record<string, string> = {},
): BunRequest<T> => {
  const req = new Request(url, options) as BunRequest<T>;

  // Mock cookies storage
  const cookieStore = new Map<string, string>();
  const setCookies: string[] = [];

  // Add params property
  Object.defineProperty(req, "params", {
    value: params,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // Add cookies API
  Object.defineProperty(req, "cookies", {
    value: {
      get: (name: string) => {
        // First check the incoming Cookie header
        const cookieHeader = req.headers.get("cookie");
        if (cookieHeader) {
          const cookies = cookieHeader.split(";").map((c) => c.trim());
          const cookie = cookies.find((c) => c.startsWith(`${name}=`));
          if (cookie) {
            return cookie.slice(name.length + 1);
          }
        }
        // Then check the mock store
        return cookieStore.get(name);
      },
      set: (name: string, value: string, options?: CookieOptions) => {
        cookieStore.set(name, value);
        let cookie = `${name}=${value}`;
        if (options?.httpOnly) cookie += "; HttpOnly";
        if (options?.secure) cookie += "; Secure";
        if (options?.sameSite)
          cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
        if (options?.path) cookie += `; Path=${options.path}`;
        if (options?.maxAge !== undefined)
          cookie += `; Max-Age=${options.maxAge}`;
        if (options?.domain) cookie += `; Domain=${options.domain}`;
        setCookies.push(cookie);
      },
      delete: (name: string) => {
        cookieStore.delete(name);
        setCookies.push(`${name}=; Max-Age=0`);
      },
      getSetCookies: () => setCookies,
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });

  return req;
};

/**
 * Get all Set-Cookie headers from a BunRequest mock
 */
export const getSetCookieHeaders = (req: BunRequest): string[] => {
  // Access the internal getSetCookies method we added
  const cookies = req.cookies as { getSetCookies?: () => string[] };
  return cookies.getSetCookies?.() || [];
};

/**
 * Find a specific cookie by name in Set-Cookie headers from a BunRequest
 */
export const findSetCookie = (
  req: BunRequest,
  cookieName: string,
): string | undefined => {
  const headers = getSetCookieHeaders(req);
  return headers.find((header) => header.startsWith(`${cookieName}=`));
};
