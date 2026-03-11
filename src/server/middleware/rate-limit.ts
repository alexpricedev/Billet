import type { BunRequest } from "bun";

const requestLog = new Map<string, number[]>();

export function rateLimit(
  req: BunRequest,
  maxRequests = 10,
  windowMs = 5000,
): Response | null {
  const ip =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();

  const timestamps = requestLog.get(ip) || [];
  const recentRequests = timestamps.filter((t) => now - t < windowMs);

  if (recentRequests.length >= maxRequests) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
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
