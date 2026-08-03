interface FlashProps {
  type: "success" | "error" | "warning";
  children: React.ReactNode;
}

const CLASS_NAMES = {
  success: "flash-success",
  error: "flash-error",
  warning: "flash-warning",
} as const;

export const Flash = ({ type, children }: FlashProps) => (
  // role="alert" (assertive) for errors and warnings so screen readers
  // interrupt and announce them - both require the user to act; role="status"
  // (polite) for success so it's announced without cutting off the user. Both
  // are announced when injected after a post-redirect-get.
  <div
    className={CLASS_NAMES[type]}
    role={type === "success" ? "status" : "alert"}
  >
    {children}
  </div>
);
