// 采集域 hook（阶段4 自 App.tsx 下沉）：采集启停控制

import { useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import {
  useStartCaptureSessionMutation,
  useStopCaptureSessionMutation,
} from "@/app/mutations";
import { formatCaptureRecordId } from "@/lib/dates";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * 采集启停：启动（返回 { ok, sessionId } 供乐观会话使用）与停止。
 * mutation onSuccess 内已 await 失效 + fetchQuery，返回时 bundle 缓存已新
 * （CaptureHub 依赖此时序判断 session running 态）。
 */
export function useCaptureSessionControls() {
  const { mutateAsync: startCaptureAsync } = useStartCaptureSessionMutation();
  const { mutateAsync: stopCaptureAsync } = useStopCaptureSessionMutation();

  const startCapture = useCallback(
    async (captureType: string): Promise<{ ok: boolean; sessionId?: number }> => {
      const wsId = useAppStore.getState().selectedWorkspaceId;
      if (!wsId) {
        notify.warning("请先选择工作区，再进行采集。");
        return { ok: false };
      }
      try {
        const resp = await startCaptureAsync({ workspaceId: wsId, allianceId: null, captureType });
        if (resp.status === "failed") {
          notify.error("采集启动失败");
        } else {
          notify.success(`采集已启动：${formatCaptureRecordId(resp.startedAt)}`);
        }
        return { ok: resp.status !== "failed", sessionId: resp.sessionId };
      } catch (e) {
        notify.error(`采集启动失败：${formatErrorMessage(e)}`);
        return { ok: false };
      }
    },
    [startCaptureAsync],
  );

  const stopCapture = useCallback(async () => {
    const wsId = useAppStore.getState().selectedWorkspaceId;
    try {
      await stopCaptureAsync(wsId);
      notify.success("采集已停止");
    } catch (e) {
      notify.error(`采集停止失败：${formatErrorMessage(e)}`);
    }
  }, [stopCaptureAsync]);

  return { startCapture, stopCapture };
}
