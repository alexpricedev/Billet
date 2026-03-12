import type { User } from "./auth";
import { db } from "./database";

export type { User };

export const getUsers = async (): Promise<User[]> => {
  const results = await db`
    SELECT id, email, role, created_at
    FROM users
    ORDER BY created_at DESC
  `;
  return results as User[];
};
