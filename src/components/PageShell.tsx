import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  /**
   * 页面内标题（重设计 2026-09-21 新增）。
   * 旧版约定「标题只由 AppShell 顶栏承担」，但顶栏会随内容滚动移出视野，
   * 长页面滚动后用户就失去了位置感；页面内保留标题是常见且必要的做法。
   */
  title?: string;
  /** 页头说明：有 title 时渲染在标题正下方，否则单独成行（兼容旧用法） */
  description?: string;
  /** 页头操作区（flex gap-2）。色彩纪律：每页至多 1 个 primary 按钮，放这里。 */
  actions?: ReactNode;
  /** 工具栏（搜索/筛选/结果计数），渲染在页头与内容之间 */
  toolbar?: ReactNode;
}

/**
 * 页面根容器统一入口：价值在统一收口，未来重设计只改一处。
 * 全部 props 均可选；都不传时不渲染页头，DOM 与扩展前完全一致（向后兼容）。
 */
export function PageShell({
  children,
  className,
  title,
  description,
  actions,
  toolbar,
}: PageShellProps) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <div className={cn("space-y-6 p-6", className)}>
      {hasHeader ? (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="text-[17px] font-medium leading-tight tracking-[-0.01em]">{title}</h2>
            ) : null}
            {description ? (
              <p className={cn("text-[12.5px] text-muted-foreground", title && "mt-1")}>
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {toolbar}
      {children}
    </div>
  );
}
