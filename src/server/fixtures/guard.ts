/**
 * Refuse to run a fixture command against production.
 *
 * Fixtures truncate every table and `persona-session` mints sessions for fixed,
 * publicly documented accounts — either is a hole in a real deployment. Called
 * before the database module is imported, because that import throws without
 * `DATABASE_URL` and would hide the refusal behind a different error.
 */
export const assertNotProduction = (
  scriptName: string,
  reason: string,
): void => {
  if (process.env.NODE_ENV !== "production") return;
  console.error(
    `${scriptName} refuses to run with NODE_ENV=production: ${reason}`,
  );
  process.exit(1);
};
