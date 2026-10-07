import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { EmptyStateIllustration, type EmptyIllustration } from "./EmptyState.illustrations";

interface EmptyStateProps {
  /** 主文案 */
  title?: string;
  /** 可选补充说明 */
  description?: string;
  /**
   * 可选 CTA（S3-1「空态即引导」）：outline 小按钮，避免每页多个 primary；
   * 不传时渲染与扩展前完全一致（向后兼容）。
   */
  action?: { label: string; onClick: () => void };
  /** V4 可选插画：beacon 灯塔 / seal 印章 / scroll 卷轴；默认不渲染 */
  illustration?: EmptyIllustration;
  className?: string;
}

export function EmptyState({ title, description, action, illustration, className }: EmptyStateProps) {
  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      {illustration ? <EmptyStateIllustration type={illustration} /> : null}
      {title ? <p>{title}</p> : null}
      {description ? <p className={title ? "mt-1" : undefined}>{description}</p> : null}
      {action ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

interface EmptyTableRowProps extends EmptyStateProps {
  colSpan: number;
}

/** 表格场景专用空态：<tr><td colSpan> 内嵌 EmptyState */
export function EmptyTableRow({ colSpan, title, description, action, illustration, className }: EmptyTableRowProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center">
        <EmptyState title={title} description={description} action={action} illustration={illustration} className={className} />
      </TableCell>
    </TableRow>
  );
}
