import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface UnitCardProps {
  title: string;
  tag?: string;
  className?: string;
  children: ReactNode;
}

export function UnitCard({ title, tag, className, children }: UnitCardProps) {
  return (
    <div className={cn("surface-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {tag ? <span className="ml-auto text-[11px] text-muted-foreground/70">{tag}</span> : null}
      </div>
      {children}
    </div>
  );
}
