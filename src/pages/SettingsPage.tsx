import React, { useState } from "react";
import { DatabaseBackup, FolderOpen, MonitorDot, RotateCcw, Settings2 } from "lucide-react";
import type { BackupResult } from "../tauri";
import { backupData, restoreData } from "../tauri";
import { formatErrorMessage } from "@/lib/format";
import { useAppData, useRefreshAppData } from "@/app/queries";
import { useAppStore } from "@/store/appStore";
import { useExportActions } from "@/features/export/useExportActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ErrorState";
import { PageShell } from "@/components/PageShell";
import { DiagnosticsContent } from "./Diagnostics";

export const SettingsPage = React.memo(function SettingsPage() {
  // 阶段4：页面自取数据与动作，不再接收 App 下钻 props
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { exportDirectory, summary, collector, bundle } = useAppData(selectedWorkspaceId);
  const { pickExportDirectory: onPickExportDirectory, resetExportDirectory: onResetExportDirectory } = useExportActions();
  const refreshAppData = useRefreshAppData();
  const onRefresh = () => refreshAppData(selectedWorkspaceId);
  // 数据备份 / 恢复
  const [backupInfo, setBackupInfo] = useState<BackupResult | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [restoreDir, setRestoreDir] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  async function handleBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError("");
    try {
      const result = await backupData(null);
      if (!result.path) {
        setBackupInfo(null);
        setBackupError("浏览器预览模式不支持数据备份，请在桌面应用中操作。");
      } else {
        setBackupInfo(result);
      }
    } catch (e) {
      setBackupError(`备份失败：${formatErrorMessage(e)}`);
    } finally {
      setBackupBusy(false);
    }
  }

  function requestRestore() {
    if (restoreBusy) return;
    const dir = restoreDir.trim();
    if (!dir) {
      setRestoreError("请先填写备份目录路径。");
      return;
    }
    setRestoreError("");
    setRestoreConfirmOpen(true);
  }

  async function executeRestore() {
    if (restoreBusy) return;
    setRestoreConfirmOpen(false);
    const dir = restoreDir.trim();
    setRestoreBusy(true);
    setRestoreError("");
    setRestoreMessage("");
    try {
      const result = await restoreData(dir);
      setRestoreMessage(result.message || (result.staged ? "已暂存恢复，重启应用后生效。" : "恢复未完成。"));
    } catch (e) {
      setRestoreError(`恢复失败：${formatErrorMessage(e)}`);
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 size={18} />
            设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 size={18} />
                导出目录
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-border px-3 py-2 text-sm">
                {exportDirectory?.path ?? "-"}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void onPickExportDirectory()}>
                  <FolderOpen size={16} className="mr-2" />
                  选择目录
                </Button>
                <Button variant="outline" onClick={() => void onResetExportDirectory()}>
                  <RotateCcw size={16} className="mr-2" />
                  重置默认
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <DatabaseBackup size={18} />
                数据备份
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleBackup()} disabled={backupBusy}>
                  <DatabaseBackup size={16} className="mr-2" />
                  {backupBusy ? "备份中…" : "立即备份"}
                </Button>
              </div>
              {backupInfo && (
                <p className="text-sm text-muted-foreground">
                  备份完成：{backupInfo.path}（{(backupInfo.bytes / 1024).toFixed(1)} KB）
                </p>
              )}
              {backupError && <ErrorState message={backupError} />}
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">从备份恢复</p>
                <div className="flex gap-2">
                  <Input
                    value={restoreDir}
                    placeholder="备份目录路径"
                    onChange={(event) => setRestoreDir(event.target.value)}
                  />
                  <Button variant="outline" onClick={requestRestore} disabled={restoreBusy}>
                    {restoreBusy ? "恢复中…" : "确认恢复"}
                  </Button>
                </div>
                {restoreMessage && <p className="text-sm text-muted-foreground">{restoreMessage}</p>}
                {restoreError && <ErrorState message={restoreError} />}
              </div>
            </CardContent>
          </Card>

          {/* I6：诊断内容并入设置页（导航已移除独立诊断入口，/diagnostics 路由保留兼容） */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MonitorDot size={18} />
                运行诊断
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DiagnosticsContent summary={summary} collector={collector} bundle={bundle} onRefresh={onRefresh} />
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="确认恢复数据？"
        description="恢复将用备份覆盖当前全部数据，此操作不可撤销。"
        confirmText="确认恢复"
        destructive
        onConfirm={() => void executeRestore()}
      />
    </PageShell>
  );
});
