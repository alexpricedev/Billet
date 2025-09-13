/**
 * pg-mem Adapter for Bun SQL Template Literals
 *
 * This module provides a bridge between pg-mem (in-memory PostgreSQL emulator) and
 * Bun's template literal SQL syntax, enabling real database testing with the same
 * SQL API used in production.
 *
 * ## Problem Solved
 * - pg-mem expects plain SQL strings, but Bun uses template literals with parameters
 * - pg-mem has issues with parameterized queries ($1, $2, etc.)
 * - Need to simulate rowCount behavior for DELETE/UPDATE operations
 *
 * ## Solution
 * Converts template literals to inline SQL by:
 * - Escaping and quoting string values
 * - Converting JavaScript types to appropriate SQL representations
 * - Handling special cases for DELETE/UPDATE queries with existence checks
 * - Providing consistent return formats for different query types
 *
 * ## Usage
 * ```typescript
 * const testDb = await initTestDb();
 * const result = await testDb.sql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 *
 * @example
 * // Input: sql`SELECT * FROM example WHERE name = ${'test'} AND id = ${123}`
 * // Output: "SELECT * FROM example WHERE name = 'test' AND id = 123"
 *
 * @see {@link createBunSqlAdapter} Main adapter function
 * @see {@link initTestDb} Database initialization in test-db.ts
 */

import type { IMemoryDb } from "pg-mem";

/**
 * Creates a Bun SQL-compatible adapter for pg-mem database
 * This allows using pg-mem with Bun's template literal SQL syntax
 */
export const createBunSqlAdapter = (pgMemDb: IMemoryDb) => {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Convert template literal to SQL with inline values (not parameterized)
    // pg-mem has issues with parameterized queries, so we'll inline values instead
    let query = strings[0];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      let sqlValue: string;

      if (value === null || value === undefined) {
        sqlValue = "NULL";
      } else if (typeof value === "string") {
        // Escape single quotes and wrap in quotes
        sqlValue = `'${value.replace(/'/g, "''")}'`;
      } else if (typeof value === "number") {
        sqlValue = value.toString();
      } else if (typeof value === "boolean") {
        sqlValue = value ? "TRUE" : "FALSE";
      } else {
        // For other types, stringify and quote
        sqlValue = `'${JSON.stringify(value).replace(/'/g, "''")}'`;
      }

      query += sqlValue + strings[i + 1];
    }

    try {
      const normalizedQuery = query.trim().toUpperCase();

      // Handle DELETE queries
      if (normalizedQuery.startsWith("DELETE")) {
        if (normalizedQuery.includes("RETURNING")) {
          // DELETE with RETURNING - use many()
          const result = pgMemDb.public.many(query);
          return Promise.resolve(result);
        }
        // For DELETE without RETURNING, check if row exists first
        const idMatch = query.match(/WHERE\s+id\s*=\s*(\d+)/i);
        if (idMatch) {
          const id = idMatch[1];
          const checkResult = pgMemDb.public.many(
            `SELECT 1 FROM example WHERE id = ${id}`,
          );
          if (checkResult.length > 0) {
            pgMemDb.public.none(query);
            return Promise.resolve([{}]); // Simulate one affected row
          }
          return Promise.resolve([]); // No rows affected
        }
        pgMemDb.public.none(query);
        return Promise.resolve([{}]);
      }

      // Handle UPDATE queries
      if (normalizedQuery.startsWith("UPDATE")) {
        if (normalizedQuery.includes("RETURNING")) {
          // UPDATE with RETURNING - first check if row exists
          const idMatch = query.match(/WHERE\s+id\s*=\s*(\d+)/i);
          if (idMatch) {
            const id = idMatch[1];
            const checkResult = pgMemDb.public.many(
              `SELECT 1 FROM example WHERE id = ${id}`,
            );
            if (checkResult.length > 0) {
              const result = pgMemDb.public.many(query);
              return Promise.resolve(result);
            }
            return Promise.resolve([]); // No rows to update
          }
          const result = pgMemDb.public.many(query);
          return Promise.resolve(result);
        }
        // UPDATE without RETURNING
        pgMemDb.public.none(query);
        return Promise.resolve([{}]);
      }

      // For all other queries (SELECT, INSERT), use many()
      const result = pgMemDb.public.many(query);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};
