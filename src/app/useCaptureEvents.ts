import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { isTauriRuntime, type CaptureSessionFinished } from "../tauri";
import { appKeys } from "./queries";
import { notify } from "@/lib/notify";
import { useAppStore } from "@/store/appStore";

/**
 * 阶段3b 采集事件驱动（在 App 顶层挂载一次）：
 * 监听后端 `capture-session-finished` 事件 → 精准失效受影响的分片 key
 * （captureSessions 在 bundle 内，一并失效 bundle/summary）+ toast 反馈。
 * 替代旧 CaptureHubPage 的 2s×120 次客户端轮询。
 */
export function useCaptureEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // 浏览器预览模式无 Tauri 事件总线，直接跳过（mock 采集同步完成）
    if (!isTauriRuntime()) return;
    let disposed = false;
    const unreg = listen<CaptureSessionFinished>("capture-session-finished", ({ payload }) => {
      if (disposed) return;
      const wsId = useAppStore.getState().selectedWorkspaceId;
      // 精准失效受影响分片：bundle（captureSessions/rawArtifacts 等小表）、
      // summary 计数、采集落库的三类大表分片域、collector 探针忙闲
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: appKeys.bundle(wsId) }),
        queryClient.invalidateQueries({ queryKey: appKeys.summary(wsId) }),
        queryClient.invalidateQueries({ queryKey: ["memberSnapshots", wsId] }),
        queryClient.invalidateQueries({ queryKey: ["allianceLogs", wsId] }),
        queryClient.invalidateQueries({ queryKey: ["battleReports", wsId] }),
        queryClient.invalidateQueries({ queryKey: appKeys.collector }),
      ]);
      if (payload.ok) {
        notify.success(`采集完成（会话 #${payload.sessionId}）`);
      } else {
        notify.error(`采集失败：${payload.error ?? "未知错误"}`);
      }
    });
    return () => {
      disposed = true;
      void unreg.then((u) => u());
    };
  }, [queryClient]);
}
