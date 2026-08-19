import type { ComponentChildren } from "preact";

interface BadgeProps {
  // Two axes share this component. "admin" / "user" are `users.role`, the
  // platform operator flag behind /admin; "owner" / "admin" / "member" are the
  // org role. They overlap on "admin" by coincidence of naming, not meaning.
  variant: "admin" | "user" | "owner" | "member";
  children: ComponentChildren;
}

export const Badge = ({ variant, children }: BadgeProps) => (
  <span className={`badge badge-${variant}`}>{children}</span>
);
