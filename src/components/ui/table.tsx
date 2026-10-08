import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 表格元件（2026-09-21 精度重做）。
 *
 * 密度调整：表格正文 14px → 12.5px，表头 h-10 → h-8，单元格 px-2 → px-2.5。
 * 数据密集场景下（成员表 8 列、阵容表 14 列）原来的行高与字号会让一屏装不下几行；
 * 表头补了 11px + tracking-wide 的弱色标签与 bg-muted/40 底色，
 * 这样调用方只需传 `sticky top-0` 就能得到符合设计基调的吸顶表头。
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { fixed?: boolean; dense?: boolean }
>(({ className, fixed, dense, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom text-[12.5px]",
        fixed && "table-fixed",
        dense && "text-[12px] [&_td]:py-1 [&_th]:h-7",
        className
      )}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-surface-2/60 data-[state=selected]:bg-accent/60",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-8 whitespace-nowrap bg-surface-2/70 px-2.5 text-left align-middle text-[11px] font-medium tracking-wide text-muted-foreground",
      "[&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-2.5 py-2 align-middle tabular-nums [&:has([role=checkbox])]:pr-0",
      numeric && "text-right",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-[12px] text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

const TableCellNumeric = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-2.5 py-2 text-right align-middle tabular-nums [&:has([role=checkbox])]:pr-0", className)} {...props} />
))
TableCellNumeric.displayName = "TableCellNumeric"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCellNumeric,
  TableCaption,
}
