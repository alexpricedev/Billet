import type { ComponentChildren } from "preact";

interface BadgeProps {
  variant: "admin" | "user";
  children: ComponentChildren;
}

export const Badge = ({ variant, children }: BadgeProps) => (
  <span className={`badge badge-${variant}`}>{children}</span>
);
