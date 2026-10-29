import type { ComponentChildren } from "preact";
import type { Tone } from "./tone";

interface BadgeProps {
  // Two axes share this component. "admin" / "user" are `users.role`, the
  // platform operator flag behind /admin; "owner" / "admin" / "member" are the
  // org role. They overlap on "admin" by coincidence of naming, not meaning.
  variant: "admin" | "user" | "owner" | "member";
  children: ComponentChildren;
}

// Each role is drawn as one of the shared tones rather than carrying a colour
// rule of its own, so a badge can never drift away from the palette. The class
// stays on the element as a hook (and because the team template's tests pin
// it), but it no longer decides anything.
const TONE_BY_VARIANT: Record<BadgeProps["variant"], Tone> = {
  admin: "accent",
  user: "neutral",
  owner: "warning",
  member: "neutral",
};

export const Badge = ({ variant, children }: BadgeProps) => (
  <span
    className={`badge badge-${variant}`}
    data-tone={TONE_BY_VARIANT[variant]}
  >
    {children}
  </span>
);
