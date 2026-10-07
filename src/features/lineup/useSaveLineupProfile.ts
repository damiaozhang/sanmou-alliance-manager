// 阵容域 hook（阶段4 自 App.tsx 下沉）：固定阵容保存

import { useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { useSaveLineupProfileMutation } from "@/app/mutations";
import type { LineupDraft } from "./types";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";

/** 固定阵容保存（手动录入/战报回填共用草稿结构）。 */
export function useSaveLineupProfile(allianceId: number | null) {
  const { mutateAsync: saveLineupProfileAsync } = useSaveLineupProfileMutation();

  const saveLineupProfile = useCallback(
    async (req: LineupDraft) => {
      const wsId = useAppStore.getState().selectedWorkspaceId;
      if (!wsId) {
        notify.warning("请先选择工作区，再进行保存固定阵容。");
        return false;
      }
      try {
        const heroes = req.heroes.split(/[/／]/).map((s) => s.trim()).filter(Boolean);
        await saveLineupProfileAsync({
          workspaceId: wsId,
          allianceId,
          playerName: req.playerName,
          playerAvatarId: req.playerAvatarId || null,
          side: "enemy",
          label: req.label,
          heroes,
          sourceBattleId: req.sourceBattleId || null,
          confidence: req.confidence,
          notes: req.notes || null,
        });
        notify.success(`固定阵容已保存：${req.label}`);
        return true;
      } catch (e) {
        notify.error(`保存失败：${formatErrorMessage(e)}`);
        return false;
      }
    },
    [allianceId, saveLineupProfileAsync],
  );

  return { saveLineupProfile };
}
