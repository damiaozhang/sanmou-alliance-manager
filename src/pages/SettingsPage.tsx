import React, { useState } from "react";
import { DatabaseBackup, FolderOpen, RotateCcw } from "lucide-react";
import type { BackupResult } from "../tauri";
import { backupData, restoreData } from "../tauri";
import { formatErrorMessage } from "@/lib/format";
import { useAppData, useRefreshAppData } from "@/app/queries";
import { useAppStore } from "@/store/appStore";
import { useExportActions } from "@/features/export/useExportActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ErrorState";
import { PageHead } from "@/components/PageHead";
import { UnitCard } from "@/components/UnitCard";
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
    <div className="p-5">
      <PageHead
        title="设置"
        description="导出目录、数据备份与运行诊断。"
      />
      <div className="space-y-4">
        <UnitCard title="导出目录" tag="导出文件落盘位置">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--hair)] py-2.5 last:border-b-0">
            <div className="min-w-0">
              <p className="text-[13px]">当前目录</p>
              <p className="truncate text-[11.5px] text-muted-foreground" title={exportDirectory?.path ?? "-"}>
                {exportDirectory?.path ?? "-"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => void onPickExportDirectory()}>
                <FolderOpen size={16} className="mr-2" />
                选择目录
              </Button>
              <Button variant="outline" onClick={() => void onResetExportDirectory()}>
                <RotateCcw size={16} className="mr-2" />
                重置默认
              </Button>
            </div>
          </div>
        </UnitCard>

        <UnitCard title="数据备份" tag="覆盖前请确认备份可用">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--hair)] py-2.5">
            <div className="min-w-0">
              <p className="text-[13px]">立即备份</p>
              <p className="text-[11.5px] text-muted-foreground">
                {backupInfo
                  ? `备份完成：${backupInfo.path}（${(backupInfo.bytes / 1024).toFixed(1)} KB）`
                  : "将当前全部数据打包到备份目录。"}
              </p>
            </div>
            <Button className="shrink-0" onClick={() => void handleBackup()} disabled={backupBusy}>
              <DatabaseBackup size={16} className="mr-2" />
              {backupBusy ? "备份中…" : "立即备份"}
            </Button>
          </div>
          {backupError && <ErrorState message={backupError} />}
          <div className="flex items-center justify-between gap-4 border-b border-[var(--hair)] py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-[13px]">从备份恢复</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={restoreDir}
                  placeholder="备份目录路径"
                  onChange={(event) => setRestoreDir(event.target.value)}
                />
                <Button className="shrink-0" variant="outline" onClick={requestRestore} disabled={restoreBusy}>
                  {restoreBusy ? "恢复中…" : "确认恢复"}
                </Button>
              </div>
              {restoreMessage && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{restoreMessage}</p>}
            </div>
          </div>
          {restoreError && <ErrorState message={restoreError} />}
        </UnitCard>

        {/* I6：诊断内容并入设置页（导航已移除独立诊断入口，/diagnostics 路由保留兼容） */}
        <DiagnosticsContent summary={summary} collector={collector} bundle={bundle} onRefresh={onRefresh} />
      </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="确认恢复数据？"
        description="恢复将用备份覆盖当前全部数据，此操作不可撤销。"
        confirmText="确认恢复"
        destructive
        onConfirm={() => void executeRestore()}
      />
    </div>
  );
});
