import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 长文本展示元件（2026-09-21 新增）。
 *
 * 背景：项目里长文本散落在日志正文、采集摘要、阵容备注、战报摘要等处，
 * 处理方式各不相同——有的 `truncate` 无提示（看不到全文）、有的直接铺满导致行高失控。
 * 统一为两种模式：
 * - 单行：截断 + 悬停 title 显示全文（表格单元格、列表副标题）；
 * - 多行：截断到 N 行 + 展开/收起（日志正文、备注）。
 *
 * 注意 `line-clamp-*` 必须写成静态类名，Tailwind JIT 不会编译动态拼接的类名，
 * 因此这里用映射表而非模板字符串。
 */

const CLAMP_CLASS: Record<number, string> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
};

/** 短于此长度不提供展开按钮，避免给一句短话配一个没用的按钮 */
const EXPAND_THRESHOLD = 60;

interface TruncatedTextProps {
  children: string;
  /** 1 = 单行截断并悬停显示全文；2~5 = 多行截断 */
  lines?: number;
  /** 多行模式下提供展开/收起 */
  expandable?: boolean;
  /** 保留原文换行（日志、备注类内容需要） */
  preserveLineBreaks?: boolean;
  className?: string;
}

export function TruncatedText({
  children,
  lines = 1,
  expandable = false,
  preserveLineBreaks = false,
  className,
}: TruncatedTextProps) {
  const [expanded, setExpanded] = useState(false);
  const text = children ?? "";

  if (lines <= 1) {
    return (
      <span className={cn("block truncate", className)} title={text}>
        {text}
      </span>
    );
  }

  const clampClass = CLAMP_CLASS[Math.min(Math.max(lines, 2), 5)] ?? CLAMP_CLASS[3];
  const shown = expanded ? undefined : clampClass;
  const canExpand = expandable && text.length > EXPAND_THRESHOLD;

  return (
    <div className={className}>
      <p
        className={cn(
          "break-words",
          preserveLineBreaks ? "whitespace-pre-wrap" : "whitespace-normal",
          shown,
        )}
      >
        {text}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 rounded text-[11.5px] text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  );
}
