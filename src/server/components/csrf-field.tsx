import type { JSX } from "react";

interface CsrfFieldProps {
  token: string | null;
}

/**
 * Reusable CSRF token field component
 * Renders hidden input with CSRF token if token is provided
 */
export const CsrfField = ({ token }: CsrfFieldProps): JSX.Element | null => {
  if (!token) {
    return null;
  }

  return <input type="hidden" name="_csrf" value={token} />;
};
