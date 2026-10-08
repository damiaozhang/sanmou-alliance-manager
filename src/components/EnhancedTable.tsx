import type { ReactNode } from "react";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface EnhancedTableProps<T> {
  columns: string[];
  rows: T[];
  renderRow: (row: T) => ReactNode;
  density?: "compact" | "comfortable";
  onRowClick?: (row: T) => void;
}

export function EnhancedTable<T>({
  columns,
  rows,
  renderRow,
  density = "comfortable",
  onRowClick,
}: EnhancedTableProps<T>) {
  return (
    <div className="surface-card overflow-hidden">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur">
          <TableRow>
            {columns.map((c) => (
              <th key={c} className="h-8 px-2.5 text-left text-[12px] font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "transition-colors hover:bg-surface-2/60",
                onRowClick && "cursor-pointer",
                density === "compact" ? "[&>td]:py-1.5" : "[&>td]:py-2.5",
              )}
            >
              {renderRow(row)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
