import type { JSX } from "react";
import { getAssetUrl } from "../services/assets";
import {
  CAPTCHA_SOLUTION_FIELD,
  type CaptchaChallenge,
} from "../services/captcha";

interface CaptchaWidgetProps {
  challenge?: CaptchaChallenge | null;
}

/**
 * Renders the proof-of-work captcha into a login form. Emits the challenge as
 * data-* attributes for the client solver, a hidden field it fills with the solved
 * payload, and the standalone solver bundle. Renders nothing when captcha is
 * disabled (no challenge passed), so the login form is unchanged in that case.
 *
 * The script is emitted here rather than in BaseLayout so only the login response
 * loads it, and everything is same-origin — no CSP change is required.
 */
export const CaptchaWidget = ({
  challenge,
}: CaptchaWidgetProps): JSX.Element | null => {
  if (!challenge) {
    return null;
  }

  return (
    <>
      <div
        data-captcha
        data-salt={challenge.salt}
        data-challenge={challenge.challenge}
        data-expires={String(challenge.expires)}
        data-maxnumber={String(challenge.maxnumber)}
        data-signature={challenge.signature}
        className="captcha-widget"
        aria-live="polite"
      >
        <span className="captcha-status">Verifying you're human…</span>
      </div>
      <input type="hidden" name={CAPTCHA_SOLUTION_FIELD} />
      <script type="module" src={getAssetUrl("/assets/captcha.js")} defer />
    </>
  );
};
