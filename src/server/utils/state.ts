if (!process.env.APP_URL) {
  throw new Error("APP_URL is not set");
}

export const stateHelpers = <T>() => ({
  parseState: (url: URL): T => {
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    return params as T;
  },

  redirectWithState: (path: string, state: T): string => {
    const url = new URL(path, process.env.APP_URL);
    for (const [key, value] of Object.entries(
      state as Record<string, unknown>,
    )) {
      if (value != null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.pathname + url.search;
  },
});
