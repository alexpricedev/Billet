import type { ComponentChildren } from "preact";

interface DataTableProps {
  children: ComponentChildren;
  className?: string;
  // A caption names the table for screen readers. It's visually hidden by
  // default (pages usually have a visible heading already); pass
  // captionVisible to show it.
  caption?: string;
  captionVisible?: boolean;
}

export const DataTable = ({
  children,
  className,
  caption,
  captionVisible,
}: DataTableProps) => (
  <table className={className ? `data-table ${className}` : "data-table"}>
    {caption && (
      <caption className={captionVisible ? undefined : "sr-only"}>
        {caption}
      </caption>
    )}
    {children}
  </table>
);
