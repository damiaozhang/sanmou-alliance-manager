// 采集中心会话装配 hook（阶段4 自 CaptureHubPage 拆出）：
// 乐观会话合并 + running 兜底 refetch + 乐观项收尾清理

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppBundle } from "../../tauri";
import { sortedCaptureSessions } from "@/lib/labels";
import { CONFIG } from "../../config";

export type OptimisticCaptureSession = { id: number; captureType: string; startedAt: string };

/**
 * 会话列表装配：
 * - 乐观会话：启动成功即插入 running 占位行，落库后被真实行替换
 * - 兜底 refetch：存在 running 会话且页面可见时，低频刷新防丢事件
 *   （主路径已由 App 顶层 useCaptureEvents 事件驱动失效）
 * - 收尾清理：pendingFocus 跟踪的会话落库且不再 running 后清除乐观项
 */
export function useCaptureSessions(
  bundle: AppBundle | null,
  onRefresh: () => Promise<AppBundle | null>,
) {
  const [optimisticSession, setOptimisticSession] = useState<OptimisticCaptureSession | null>(null);
  const [pendingFocusSessionId, setPendingFocusSessionId] = useState<number | null>(null);

  const sessions = useMemo(() => {
    const base = sortedCaptureSessions(bundle?.captureSessions);
    if (!optimisticSession) return base;
    if (base.some((session) => session.id === optimisticSession.id)) return base;
    return [
      {
        id: optimisticSession.id,
        captureType: optimisticSession.captureType,
        status: "running",
        startedAt: optimisticSession.startedAt,
        finishedAt: null,
        summaryJson: "",
      },
      ...base,
    ];
  }, [bundle?.captureSessions, optimisticSession]);

  const hasRunningSession = sessions.some((s) => s.status === "running");
  useEffect(() => {
    if (!hasRunningSession) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void onRefresh();
    }, CONFIG.scan.fallbackRefetchMs);
    return () => window.clearInterval(timer);
  }, [hasRunningSession, onRefresh]);

  // 乐观会话收尾：pendingFocus 跟踪的会话落库且不再 running 后清理乐观项
  useEffect(() => {
    if (pendingFocusSessionId === null) return;
    const next = sessions.find((session) => session.id === pendingFocusSessionId);
    if (next && next.status !== "running") {
      setPendingFocusSessionId(null);
      setOptimisticSession(null);
    }
  }, [pendingFocusSessionId, sessions]);

  const markSessionStarted = useCallback((sessionId: number, captureType: string) => {
    setOptimisticSession({ id: sessionId, captureType, startedAt: new Date().toISOString() });
    setPendingFocusSessionId(sessionId);
  }, []);

  const clearOptimistic = useCallback(() => {
    setPendingFocusSessionId(null);
    setOptimisticSession(null);
  }, []);

  return { sessions, markSessionStarted, clearOptimistic };
}
