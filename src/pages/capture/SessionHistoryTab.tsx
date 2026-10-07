// 「会话历史」tab：全部会话（含失败）列表（阶段4 自 CaptureHubPage 拆出）
// 支持逐条删除会话历史（含其关联的 raw_artifact 磁盘文件）。

import React, { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CaptureSessionRow } from "../../tauri";
import { deleteCaptureSession } from "../../tauri";
import { captureTypeLabel, captureStatusBadge, summarizeSessionNote } from "../../lib/labels";
import { formatCaptureRecordTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** 会话历史默认展示条数（超出部分在表下方给出「共 N 条」提示，避免静默截断） */
const SESSION_HISTORY_LIMIT = 20;

export const SessionHistoryTab = React.memo(function SessionHistoryTab({
  sessions,
  onStartAlliance,
  workspaceId,
  onDeleted,
}: {
  sessions: CaptureSessionRow[];
  onStartAlliance: () => void;
  workspaceId: number | null;
  onDeleted: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<CaptureSessionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete || deleteBusy) return;
    if (workspaceId == null) {
      setDeleteError("当前没有选中的工作区，无法删除会话。");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteCaptureSession(pendingDelete.id, workspaceId);
      setPendingDelete(null);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, onDeleted, pendingDelete, workspaceId]);

  if (sessions.length === 0) {
    return <EmptyState title="还没有采集记录" action={{ label: "采集同盟数据", onClick: onStartAlliance }} />;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 bg-muted/50">开始时间</TableHead>
            <TableHead className="sticky top-0 bg-muted/50">类型</TableHead>
            <TableHead className="sticky top-0 bg-muted/50">状态</TableHead>
            <TableHead className="sticky top-0 bg-muted/50">摘要</TableHead>
            <TableHead className="sticky top-0 bg-muted/50 w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.slice(0, SESSION_HISTORY_LIMIT).map((s) => {
            const statusBadge = captureStatusBadge(s.status);
            return (
              <TableRow key={s.id}>
                <TableCell className="tabular-nums">{formatCaptureRecordTime(s.startedAt)}</TableCell>
                <TableCell>{captureTypeLabel(s.captureType)}</TableCell>
                <TableCell>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                  {summarizeSessionNote(s)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title="删除此会话历史"
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete(s);
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* P1-10：此前 slice(0,20) 静默截断，页面看不出还有更多历史 */}
      {sessions.length > SESSION_HISTORY_LIMIT ? (
        <p className="mt-2 text-sm text-muted-foreground">
          共 {sessions.length.toLocaleString("zh-CN")} 条 · 仅显示最近 {SESSION_HISTORY_LIMIT} 条
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除此会话？"
        description={`将删除 ${formatCaptureRecordTime(pendingDelete?.startedAt ?? "")} 的「${pendingDelete ? captureTypeLabel(pendingDelete.captureType) : ""}」会话及其关联的采集原始文件，此操作不可撤销。`}
        confirmText={deleteBusy ? "删除中…" : "删除"}
        destructive
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />
      {deleteError && <p className="mt-3 text-sm text-destructive">{deleteError}</p>}
    </>
  );
});
