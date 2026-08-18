// Whether the app groups users into organisations. Off by default: an app that
// was built without organisations has no name to put on one, and turning this on
// changes what sign-up asks for and what /login is willing to create.
//
// Read from process.env on every call (not captured at import) so tests can flip
// it between cases, matching `authMode` in auth-mode.ts and `captchaEnabled` in
// captcha.ts.

export const ORGANISATIONS_FLAGS: readonly string[] = ["true", "false"];

export const isOrganisationsFlag = (value: string | undefined): boolean =>
  ORGANISATIONS_FLAGS.includes(value as string);

/**
 * Whether organisation memberships are enabled.
 *
 * Unlike CAPTCHA_ENABLED, which treats anything but "true" as off, a value
 * outside the set is rejected at boot by validateEnv. A captcha that silently
 * stays off is a missing defence; organisations that silently stay off is an app
 * serving a different data model than the operator thinks it is.
 */
export const organisationsEnabled = (): boolean =>
  process.env.ORGANISATIONS_ENABLED === "true";
