/**
 * Database utility types and helpers
 */

/**
 * Result type for DELETE and UPDATE operations in Bun SQL
 * Contains count of affected rows
 */
export interface DatabaseMutationResult {
  count?: number;
}

/**
 * Check if a database mutation (DELETE/UPDATE) affected any rows
 * Returns true if count > 0, false otherwise
 */
export const hasAffectedRows = (result: DatabaseMutationResult): boolean => {
  return Boolean(result.count && result.count > 0);
};
