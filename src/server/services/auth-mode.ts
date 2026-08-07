// Which credential the app accepts. The two modes are mutually exclusive on
// purpose: offering both at once means every account has two ways in, and the
// weaker one sets the security ceiling.
//
// Read from process.env on every call (not captured at import) so tests can
// flip the mode between cases, matching `captchaEnabled` in captcha.ts.

export type AuthMode = "magic-link" | "password";

export const AUTH_MODES: readonly AuthMode[] = ["magic-link", "password"];

export const isAuthMode = (value: string | undefined): value is AuthMode =>
  AUTH_MODES.includes(value as AuthMode);

/**
 * The active auth mode. Defaults to magic-link, which is what the app shipped
 * with — an unset AUTH_MODE must never change behaviour for an existing fork.
 *
 * An invalid value is rejected at boot by validateEnv, so by the time a request
 * is served this can only be one of the two.
 */
export const authMode = (): AuthMode =>
  process.env.AUTH_MODE === "password" ? "password" : "magic-link";

export const passwordAuthEnabled = (): boolean => authMode() === "password";
