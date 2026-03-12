interface FlashProps {
  type: "success" | "error";
  children: React.ReactNode;
}

export const Flash = ({ type, children }: FlashProps) => (
  <div className={type === "success" ? "flash-success" : "flash-error"}>
    {children}
  </div>
);
