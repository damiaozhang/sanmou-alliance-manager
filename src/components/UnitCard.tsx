import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface UnitCardProps {
  title: string;
  tag?: string;
  /** 右侧操作位（按钮/徽标），与 tag 同排靠右 */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function UnitCard({ title, tag, action, className, children }: UnitCardProps) {
  return (
    <div className={cn("surface-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {(tag || action) && (
          <div className="ml-auto flex items-center gap-2">
            {tag ? <span className="text-[11px] text-muted-foreground/70">{tag}</span> : null}
            {action}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
