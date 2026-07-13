interface FlashProps {
  type: "success" | "error";
  children: React.ReactNode;
}

export const Flash = ({ type, children }: FlashProps) => (
  // role="alert" (assertive) for errors so screen readers interrupt and announce
  // them; role="status" (polite) for success so it's announced without cutting
  // off the user. Both are announced when injected after a post-redirect-get.
  <div
    className={type === "success" ? "flash-success" : "flash-error"}
    role={type === "success" ? "status" : "alert"}
  >
    {children}
  </div>
);
