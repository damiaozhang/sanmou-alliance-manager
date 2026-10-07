// 工作区域 hook（阶段4 自 App.tsx 下沉）：表单、新建/切换/守卫

import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useAppData } from "@/app/queries";
import { useCreateWorkspaceMutation } from "@/app/mutations";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";

export const DEFAULT_WORKSPACE_FORM = {
  name: "默认工作区",
  serverName: "未设置服务器",
  seasonName: "2026 赛季",
  allianceName: "未设置同盟",
  allianceGameId: "",
};

export type WorkspaceForm = typeof DEFAULT_WORKSPACE_FORM;

/**
 * 工作区管理：新建表单状态、创建、切换、当前活动工作区解析与守卫。
 * 数据经 useAppData 按 query key 缓存，多处调用不产生额外请求。
 */
export function useWorkspaceManagement() {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);
  const { workspaces } = useAppData(selectedWorkspaceId);
  const { mutateAsync: createWorkspaceAsync } = useCreateWorkspaceMutation();
  const [form, setForm] = useState<WorkspaceForm>(DEFAULT_WORKSPACE_FORM);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) ?? workspaces[0],
    [selectedWorkspaceId, workspaces],
  );

  const handleCreateWorkspace = useCallback(async () => {
    try {
      const resp = await createWorkspaceAsync({ ...form, allianceGameId: form.allianceGameId || null });
      setSelectedWorkspaceId(resp.workspace.id);
      notify.success(`已创建工作区：${resp.workspace.name}`);
    } catch (e) {
      notify.error(`创建工作区失败：${formatErrorMessage(e)}`);
    }
  }, [form, createWorkspaceAsync, setSelectedWorkspaceId]);

  const handleSelectWorkspace = useCallback((id: number) => {
    setSelectedWorkspaceId(id);
  }, [setSelectedWorkspaceId]);

  // 无活动工作区时给出提示并返回 null，调用方据此短路
  const requireActiveWorkspace = useCallback((label: string) => {
    if (!activeWorkspace) {
      notify.warning(`请先选择工作区，再进行${label}。`);
      return null;
    }
    return activeWorkspace.id;
  }, [activeWorkspace]);

  return {
    form,
    setForm,
    workspaces,
    activeWorkspace,
    handleCreateWorkspace,
    handleSelectWorkspace,
    requireActiveWorkspace,
  };
}
