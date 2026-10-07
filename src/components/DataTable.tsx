import { useMemo, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 列定义：width 为 grid-template-columns 片段（如 "120px" / "1fr" / "minmax(200px,2fr)"）。 */
export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  width: string;
  /** 表头格附加 className */
  headerClassName?: string;
  /** 数据格附加 className（每行一致） */
  cellClassName?: string;
  render: (row: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  /** 当前页数据（服务端分页为当前 limit/offset 结果；客户端分页为当前页切片） */
  rows: T[];
  /** 全量条数（服务端分页用后端 total；客户端分页用 rows 全集长度） */
  total: number;
  /** 当前页码，1 基 */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  columns: DataTableColumn<T>[];
  rowKey: (row: T, index: number) => string | number;
  /** 行高估算（px），默认 40 */
  rowHeight?: number;
  /** 滚动区最大高度（px），默认 600 */
  maxHeight?: number;
  emptyTitle?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T, index: number) => string | undefined;
  /** placeholderData 保留上一页时置灰提示数据切换中 */
  isPlaceholder?: boolean;
  /** jsdom 等无 ResizeObserver 环境注入容器初始尺寸（测试用） */
  initialRect?: { width: number; height: number };
}

/**
 * 阶段3b 通用虚拟表格：@tanstack/react-virtual 虚拟化 + 固定表头 + 受控分页器。
 * 服务端分页与客户端分页通用——rows 给什么渲染什么，total/page/pageSize 决定分页器。
 */
export function DataTable<T>({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  columns,
  rowKey,
  rowHeight = 40,
  maxHeight = 600,
  emptyTitle = "暂无数据",
  onRowClick,
  rowClassName,
  isPlaceholder = false,
  initialRect,
}: DataTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: columns.map((c) => c.width).join(" ") }),
    [columns],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    initialRect: initialRect ? new DOMRect(0, 0, initialRect.width, initialRect.height) : undefined,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // 页码钳制：rows 缩减（删除/过滤）后当前页越界时不渲染空白页
  const safePage = Math.min(Math.max(1, page), pageCount);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border" role="table" aria-rowcount={total}>
        <div
          ref={parentRef}
          className="overflow-auto"
          style={{ maxHeight: `${maxHeight}px`, scrollbarGutter: "stable both-edges" }}
          role="presentation"
        >
          {rows.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {isPlaceholder ? "加载中…" : emptyTitle}
            </div>
          ) : (
            <div role="presentation">
              <div
                className="sticky top-0 z-10 grid border-b bg-muted/50 text-xs font-medium text-muted-foreground"
                style={{ ...gridStyle, height: "40px" }}
                role="row"
              >
                {columns.map((col) => (
                  <div key={col.key} role="columnheader" className={cn("flex items-center px-2", col.headerClassName)}>
                    {col.header}
                  </div>
                ))}
              </div>
              <div role="rowgroup">
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                  role="presentation"
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    return (
                      <div
                        key={rowKey(row, virtualRow.index)}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          ...gridStyle,
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className={cn(
                          "grid items-center border-b text-sm hover:bg-muted/50",
                          onRowClick && "cursor-pointer",
                          isPlaceholder && "opacity-60",
                          rowClassName?.(row, virtualRow.index),
                        )}
                        role="row"
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {columns.map((col) => (
                          <div key={col.key} role="cell" className={cn("min-w-0 truncate px-2", col.cellClassName)}>
                            {col.render(row, virtualRow.index)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 分页器：总数 + 页码 + 上一页/下一页 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span className="tabular-nums">
          共 {total} 条 · 第 {safePage}/{pageCount} 页
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            <ChevronLeft size={14} className="mr-1" />
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount}
            onClick={() => onPageChange(safePage + 1)}
          >
            下一页
            <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
