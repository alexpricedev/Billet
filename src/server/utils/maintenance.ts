import { render503 } from "./errors";

// App-level maintenance mode. Set MAINTENANCE_MODE=true to serve a 503 "we'll be
// right back" page (with Retry-After) for every request. Intended as a fallback
// — prefer flipping maintenance at your edge/CDN when you can, since the app is
// what you're taking offline. MAINTENANCE_RETRY_AFTER overrides the default
// Retry-After (seconds).
const DEFAULT_RETRY_AFTER_SECONDS = 3600;

// Returns a 503 response when maintenance mode is on, otherwise null so the
// request continues normally. The platform health check is exempt so the host
// doesn't cycle the instance while it's intentionally serving 503s.
export const maintenanceResponse = (req: Request): Response | null => {
  if (process.env.MAINTENANCE_MODE !== "true") return null;

  const { pathname } = new URL(req.url);
  if (pathname === "/health") return null;

  const configured = Number(process.env.MAINTENANCE_RETRY_AFTER);
  const retryAfter =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RETRY_AFTER_SECONDS;

  return render503(retryAfter);
};
