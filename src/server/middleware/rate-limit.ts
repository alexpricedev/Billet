import type { BunRequest } from "bun";
import { jsonError } from "../utils/response";
import { clientKey } from "./client-ip";

const requestLog = new Map<string, number[]>();

export function rateLimit(
  req: BunRequest,
  maxRequests = 10,
  windowMs = 5000,
): Response | null {
  const ip = clientKey(req);
  const now = Date.now();

  const timestamps = requestLog.get(ip) || [];
  const recentRequests = timestamps.filter((t) => now - t < windowMs);

  if (recentRequests.length >= maxRequests) {
    // Seconds until the oldest request in the window ages out — the earliest
    // moment a retry can succeed. Clients that honour Retry-After back off
    // exactly that far instead of hammering, and crawlers stop counting the
    // 429 against the site.
    const oldest = recentRequests[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

    return jsonError(
      429,
      "rate_limited",
      "Too many requests. Please slow down and try again shortly.",
      { headers: { "Retry-After": String(retryAfter) } },
    );
  }

  recentRequests.push(now);
  requestLog.set(ip, recentRequests);

  return null;
}

export function cleanupRateLimitLog(maxAgeMs = 60000): void {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const recent = timestamps.filter((t) => now - t < maxAgeMs);
    if (recent.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, recent);
    }
  }
}

export function clearRateLimitLog(): void {
  requestLog.clear();
}

setInterval(() => {
  cleanupRateLimitLog();
}, 300000);
