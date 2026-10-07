// 工作区上下文 hook（阶段4）：页面自取 workspaceId/allianceId，替代 App 下钻 props

import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useAppData } from "@/app/queries";

/**
 * 页面级工作区上下文：当前选中（或首个）工作区的 id 与 allianceId。
 * 数据来源为 useAppData 的缓存查询，多处调用不产生额外请求。
 */
export function useActiveWorkspaceContext() {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { workspaces } = useAppData(selectedWorkspaceId);
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) ?? workspaces[0] ?? null,
    [selectedWorkspaceId, workspaces],
  );
  return {
    activeWorkspace,
    workspaceId: activeWorkspace?.id ?? null,
    allianceId: activeWorkspace?.allianceId ?? null,
  };
}
