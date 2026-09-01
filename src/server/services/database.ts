import { SQL } from "bun";
import { log } from "./logger";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

let closing = false;

export const db = new SQL(process.env.DATABASE_URL, {
  // Keep the pool healthy on hosts whose private network silently drops idle
  // TCP connections (e.g. Railway). Recycle connections before they go stale so
  // a request never gets handed a dead socket (the cause of hung requests that
  // surface as upstream 502/499 errors).
  max: 10,
  idleTimeout: 20,
  maxLifetime: 300,
  connectionTimeout: 10,
  onclose: (err) => {
    if (!err || closing) return;
    // Idle-timeout and max-lifetime closes are the pool doing its job —
    // recycling connections before the network drops them. Only surface
    // genuinely unexpected closes (e.g. network resets).
    if (/idle timeout|lifetime/i.test(err.message)) return;
    log.warn("database", `Connection closed unexpectedly: ${err.message}`);
  },
});

/**
 * Close the pool on shutdown. `db.close()` fires `onclose` for every pooled
 * connection with a generic "Connection closed" error, which the warn above
 * would misreport as unexpected — the flag marks the drain as deliberate.
 */
export const closeDatabase = async (): Promise<void> => {
  closing = true;
  await db.close();
};

// Test database connection
export const testConnection = async (): Promise<boolean> => {
  try {
    await db`SELECT 1`;
    return true;
  } catch (error) {
    log.error(
      "database",
      `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
};
