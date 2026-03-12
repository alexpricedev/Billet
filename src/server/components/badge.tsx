interface BadgeProps {
  variant: "admin" | "user";
  children: React.ReactNode;
}

export const Badge = ({ variant, children }: BadgeProps) => (
  <span className={`badge badge-${variant}`}>{children}</span>
);
