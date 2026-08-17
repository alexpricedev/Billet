// Whether org-level user management is on. Off by default: an unset flag must
// never change behaviour for an existing fork, and with it off nothing ever
// writes an org, so the columns and tables migration 008 adds stay empty.
//
// A boolean rather than a mode string, unlike AUTH_MODE. That is a mode because
// both of its values are real behaviours and there is no "off"; this feature is
// purely additive, so it matches CAPTCHA_ENABLED instead.
//
// It does take AUTH_MODE's *fatal* validation, which CAPTCHA_ENABLED lacks:
// TEAMS_ENABLED=1 or =yes would silently 404 an entire authorisation surface,
// and an owner seeing a 404 on their own team page reads that as a bug rather
// than a mode.
//
// Read from process.env on every call (not captured at import) so tests can
// flip it between cases, matching `authMode` in auth-mode.ts and
// `captchaEnabled` in captcha.ts.
//
// Naming: the URL and the UI say "team"; the database says "org", because that
// is what the row is. The split is deliberate, not drift.

export const TEAMS_FLAG_VALUES = ["true", "false"] as const;

export type TeamsFlagValue = (typeof TEAMS_FLAG_VALUES)[number];

export const isTeamsFlagValue = (
  value: string | undefined,
): value is TeamsFlagValue =>
  TEAMS_FLAG_VALUES.includes(value as TeamsFlagValue);

/**
 * Whether team management is enabled.
 *
 * An invalid value is rejected at boot by validateEnv, so by the time a request
 * is served this can only reflect one of the two literals.
 */
export const teamsEnabled = (): boolean => process.env.TEAMS_ENABLED === "true";
