import { SQL } from "bun";
import { log } from "./logger";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const db = new SQL(process.env.DATABASE_URL);

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
