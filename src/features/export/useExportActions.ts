// 导出域 hook（阶段4 自 App.tsx 下沉）：8 个导出动作 + 单条战报导出 + 导出目录

import { useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import {
  useExportMutation,
  usePickExportDirectoryMutation,
  useResetExportDirectoryMutation,
} from "@/app/mutations";
import { exportConfigs, type ExportKey } from "./exportConfigs";
import { exportBattleReportHtml, exportBattleReportJson } from "@/tauri";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * 导出动作集合：runExport 直接读 store 取当前工作区（替代旧 ref 通道），
 * 配合稳定的 exportAsync 保持引用稳定，进而使派生的 exportActions 稳定，
 * 避免下游 React.memo 子页面无谓重渲染。
 */
export function useExportActions() {
  const { mutateAsync: exportAsync } = useExportMutation();
  const { mutateAsync: pickExportDirectoryAsync } = usePickExportDirectoryMutation();
  const { mutateAsync: resetExportDirectoryAsync } = useResetExportDirectoryMutation();

  const runExport = useCallback(
    async (
      label: string,
      missingWorkspaceMessage: string,
      exporter: (workspaceId: number) => Promise<{ paths: string[] }>,
    ) => {
      const wsId = useAppStore.getState().selectedWorkspaceId;
      if (!wsId) {
        notify.warning(missingWorkspaceMessage);
        return;
      }
      try {
        const result = await exportAsync({ workspaceId: wsId, exporter });
        notify.success(`${label}已导出：${result.paths.join(" / ")}`);
      } catch (error) {
        notify.error(`${label}失败：${formatErrorMessage(error)}`);
      }
    },
    [exportAsync],
  );

  // 由 exportConfigs + runExport 派生的 8 个导出动作，全部走同一份配置
  const exportActions = useMemo(() => {
    const actions = {} as Record<ExportKey, () => Promise<void>>;
    for (const cfg of exportConfigs) {
      actions[cfg.key] = () => runExport(cfg.label, cfg.missingMsg, cfg.exporter);
    }
    return actions;
  }, [runExport]);

  // 单条战报导出（战报时间线页逐行入口）：workspaceId 从 store 现取，
  // 复用 exportAsync 的 bundle 失效语义，保证导出后 export_job 历史可见。
  const exportBattleReport = useCallback(
    async (battleCode: string, format: "json" | "html") => {
      const wsId = useAppStore.getState().selectedWorkspaceId;
      if (!wsId) {
        notify.warning("请先选择工作区，再进行单条战报导出。");
        return;
      }
      const label = format === "json" ? "战报 JSON" : "战报 HTML";
      try {
        const result = await exportAsync({
          workspaceId: wsId,
          exporter: (id) =>
            format === "json"
              ? exportBattleReportJson(battleCode, id)
              : exportBattleReportHtml(battleCode, id),
        });
        notify.success(`${label}已导出：${result.paths.join(" / ")}`);
      } catch (error) {
        notify.error(`${label}导出失败：${formatErrorMessage(error)}`);
      }
    },
    [exportAsync],
  );

  const pickExportDirectory = useCallback(async () => {
    try {
      // mutation onSuccess 已把新目录 setQueryData 写入缓存
      const next = await pickExportDirectoryAsync();
      notify.success(`导出目录已设置：${next.path}`);
    } catch (error) {
      notify.error(`导出目录设置失败：${formatErrorMessage(error)}`);
    }
  }, [pickExportDirectoryAsync]);

  const resetExportDirectory = useCallback(async () => {
    try {
      const next = await resetExportDirectoryAsync();
      notify.success(`导出目录已重置：${next.path}`);
    } catch (error) {
      notify.error(`导出目录重置失败：${formatErrorMessage(error)}`);
    }
  }, [resetExportDirectoryAsync]);

  return { exportActions, exportBattleReport, pickExportDirectory, resetExportDirectory };
}
