import { HONEYPOT_FIELD } from "../services/captcha";

/**
 * Bot-trap field. A real text input, hidden from humans and — critically —
 * flagged so password managers and browser autofill leave it empty. Bots that
 * fill every field trip it; the controller then silently discards the request.
 *
 * The opt-out attributes matter: a filled honeypot is treated as a bot and the
 * submission is dropped with no user and no email, so a false positive means a
 * real person is turned away invisibly. The `data-*-ignore` hints below are
 * honored by 1Password, LastPass, Bitwarden and Dashlane, and the neutral field
 * name (no email/name/address/company/url token) keeps native autofill away.
 */
export const Honeypot = () => (
  <input
    type="text"
    name={HONEYPOT_FIELD}
    tabIndex={-1}
    autoComplete="off"
    aria-hidden="true"
    data-1p-ignore=""
    data-lpignore="true"
    data-bwignore=""
    data-form-type="other"
    style={{
      position: "absolute",
      left: "-9999px",
      width: "1px",
      height: "1px",
      opacity: 0,
    }}
  />
);
