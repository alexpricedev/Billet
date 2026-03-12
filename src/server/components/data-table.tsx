interface DataTableProps {
  children: React.ReactNode;
  className?: string;
}

export const DataTable = ({ children, className }: DataTableProps) => (
  <table className={className ? `data-table ${className}` : "data-table"}>
    {children}
  </table>
);
