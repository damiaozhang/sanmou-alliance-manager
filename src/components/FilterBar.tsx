import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 筛选条元件（2026-09-21 新增）。
 *
 * 背景：本项目里"筛选"此前是各页各写一套——有的用 Select 下拉、有的用手写 button、
 * 有的干脆没有；而且出现了「筛选生效但筛选条不渲染」导致用户看不到被过滤原因的问题
 * （`AllianceDataPage.tsx:60-62` 的筛选 state 是页面级，筛选条却只在成员 tab 里）。
 * 统一为一组元件后，筛选状态可以被明确表达：当前选中项 + 结果计数 + 一键清除。
 */

interface FilterChipProps {
  /** 是否选中。视觉上同时用边框色、底色与字重三重表达，不依赖单一颜色 */
  active?: boolean;
  /** 可选计数（如「在线 42」），用 tabular-nums 保证数字列对齐 */
  count?: number;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function FilterChip({ active, count, onClick, children, className }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "border-primary/35 bg-primary/10 font-medium text-primary"
          : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
        className,
      )}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-primary/70" : "text-muted-foreground/60",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** 筛选组之间的竖向分隔（纯装饰） */
export function FilterDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

interface FilterBarProps {
  children: ReactNode;
  /** 右侧结果描述，例如「已筛选：未绑定 · 6 条」。有筛选时必须给，避免用户不知道数据被过滤过 */
  summary?: ReactNode;
  /** 清除全部筛选 */
  onClear?: () => void;
  className?: string;
}

export function FilterBar({ children, summary, onClear, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1.5",
        className,
      )}
    >
      {children}
      {summary || onClear ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-3 text-[11.5px] text-muted-foreground">
          {summary ? <span className="tabular-nums">{summary}</span> : null}
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              清除
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
