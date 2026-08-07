import type { JSX } from "preact";
import type { User } from "../services/users";

interface VerifyBannerProps {
  user?: User | null;
}

/**
 * Fixed reminder for a signed-in user who hasn't confirmed their email address.
 *
 * No auth-mode check is needed. A magic-link sign-in stamps email_verified_at
 * because clicking the link proves ownership, and migration 007 backfilled
 * every pre-existing user, so an unverified account can only exist in password
 * mode.
 *
 * Nothing in the app is gated on verification — this is advisory. A fork that
 * wants to withhold a feature until the address is confirmed reads
 * `user.email_verified_at` at the point it cares about.
 *
 * It links to /account rather than embedding a resend button: CSRF tokens are
 * bound to a method and path, so an inline form would force every controller
 * that renders Layout to mint a second token just in case.
 */
export const VerifyBanner = ({
  user,
}: VerifyBannerProps): JSX.Element | null => {
  if (!user || user.email_verified_at) {
    return null;
  }

  // No live region: this is server-rendered on every page load, so it already
  // sits first in the reading order. Marking it live would re-announce it on
  // every single navigation.
  return (
    <div className="verify-banner">
      <span>Confirm your email address to secure your account.</span>
      <a href="/account#verify-email">Resend the link</a>
    </div>
  );
};
