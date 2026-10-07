// 同盟成员绑定域 hook（阶段4 自 App.tsx 下沉）

import { useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { useAppData } from "@/app/queries";
import { useSaveMemberBindingMutation, useSyncMemberBindingsMutation } from "@/app/mutations";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * 成员绑定：单条手动保存 + 从阵容统计批量自动绑定。
 * 自动绑定与战报采集流程中的 buildAutoBindingRequests 同一语义，
 * 供成员绑定页手动触发；写操作统一走 mutations 体系失效分片缓存。
 */
export function useMemberBindingActions(allianceId: number | null) {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { lineupAnalysis } = useAppData(selectedWorkspaceId);
  const { mutateAsync: saveMemberBindingAsync } = useSaveMemberBindingMutation();
  const { mutateAsync: syncBindingsAsync } = useSyncMemberBindingsMutation();

  const saveMemberBinding = useCallback(
    async (req: { avatarName: string; avatarId: string; confidence: string }) => {
      const wsId = useAppStore.getState().selectedWorkspaceId;
      if (!wsId) {
        notify.warning("请先选择工作区，再进行保存成员绑定。");
        return false;
      }
      try {
        await saveMemberBindingAsync({ workspaceId: wsId, allianceId, ...req });
        notify.success(`成员绑定已保存：${req.avatarName}`);
        return true;
      } catch (e) {
        notify.error(`保存失败：${formatErrorMessage(e)}`);
        return false;
      }
    },
    [allianceId, saveMemberBindingAsync],
  );

  const autoBindMembers = useCallback(async (): Promise<number> => {
    const wsId = useAppStore.getState().selectedWorkspaceId;
    if (!wsId) {
      notify.warning("请先选择工作区，再进行自动绑定。");
      return 0;
    }
    const candidates = lineupAnalysis.stats.filter((s) => s.avatarId && s.playerName);
    if (candidates.length === 0) {
      notify.info("暂无阵容统计数据，请先采集战报（战报采集页会自动绑定）。");
      return 0;
    }
    try {
      const count = await syncBindingsAsync(
        candidates.map((s) => ({
          workspaceId: wsId,
          allianceId,
          avatarId: s.avatarId,
          avatarName: s.playerName,
          confidence: "自动绑定",
        })),
      );
      if (count > 0) notify.success(`已自动绑定 ${count} 名成员`);
      return count;
    } catch (error) {
      notify.error(`自动绑定失败：${formatErrorMessage(error)}`);
      return 0;
    }
  }, [allianceId, lineupAnalysis.stats, syncBindingsAsync]);

  return { saveMemberBinding, autoBindMembers };
}
