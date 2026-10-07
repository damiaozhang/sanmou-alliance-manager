import { useEffect } from "react";
import type { WorkspaceRecord } from "../tauri";
import { useAppStore } from "@/store/appStore";

// 工作区自动选择：workspaces 为空清选择；选中失效回退第一个。
// isLoading 守卫（S1-2 审查修复 C1）：workspaces 从当前 queryKey 的 bundle 派生，
// 切到未缓存工作区（或启动时首个 query pending）时 bundle 尚未到达，workspaces 短暂为空——
// 此时跳过清空与回退，否则会覆盖用户刚做的选择 / persist 恢复的选择；
// 数据到达后 effect 因 isLoading/workspaces 变化重跑，再按原规则正常校验。
export function useWorkspaceAutoSelect(workspaces: WorkspaceRecord[], isLoading: boolean) {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);
  useEffect(() => {
    if (isLoading) return;
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null);
      return;
    }
    if (!selectedWorkspaceId || !workspaces.some((w) => w.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [isLoading, selectedWorkspaceId, workspaces, setSelectedWorkspaceId]);
}
