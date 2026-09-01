import type { SocketAddress } from "bun";

type IpSource = { requestIP(req: Request): SocketAddress | null };

// `server.requestIP()` is the only way to read the socket address, and the
// server instance doesn't exist until `Bun.serve()` returns — main.ts wires it
// in here right after. Requests handled before that (there are none: routes
// aren't reachable until serve returns) fall back to "unknown".
let ipSource: IpSource | null = null;

export const setIpSource = (source: IpSource | null): void => {
  ipSource = source;
};

/** Read on every call, like authMode(), so tests can flip it per case. */
const trustProxy = (): boolean => process.env.TRUST_PROXY === "true";

/**
 * The key the rate limiter buckets a request under.
 *
 * `x-forwarded-for` is client-controlled: anyone can send a fresh value per
 * request and walk straight past a limit keyed on it. So the header is only
 * believed when TRUST_PROXY=true — deployments behind exactly one proxy that
 * rewrites or appends to the header itself (Railway does) — and even then only
 * its *last* entry, the one hop the proxy added. Everything left of it arrived
 * in the client's own request and stays untrusted.
 *
 * Everywhere else the socket address is the client, and the header is ignored.
 * TRUST_PROXY defaults off: misconfigured-off behind a proxy collapses every
 * client into one visible bucket (a support ticket), misconfigured-on without
 * a proxy is a silent bypass (an incident).
 */
export const clientKey = (req: Request): string => {
  if (trustProxy()) {
    const forwarded = req.headers.get("x-forwarded-for");
    const lastHop = forwarded?.split(",").at(-1)?.trim();
    if (lastHop) return lastHop;
  }

  return ipSource?.requestIP(req)?.address ?? "unknown";
};
