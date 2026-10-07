import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/lib/sort";

type SortIndicatorProps = {
  active: boolean;
  direction: SortDirection;
  className?: string;
};

export function SortIndicator({ active, direction, className }: SortIndicatorProps) {
  if (!active) {
    return <ChevronsUpDown size={14} className={cn("ml-1 inline-block text-muted-foreground", className)} />;
  }
  if (direction === "asc") {
    return <ArrowUp size={14} className={cn("ml-1 inline-block text-primary", className)} />;
  }
  return <ArrowDown size={14} className={cn("ml-1 inline-block text-primary", className)} />;
}
