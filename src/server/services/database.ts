import { SQL } from "bun";

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
    console.error("Database connection failed:", error);
    return false;
  }
};
