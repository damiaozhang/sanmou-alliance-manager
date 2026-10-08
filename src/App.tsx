// 阶段4 薄壳 App：只做路由装配与顶层 Provider 关注点，页面一律自取数据
// （handler 已按域下沉至 features/workspace、features/capture、features/export 等 hooks）

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { SuspenseFallback } from "./components/SuspenseFallback";
import {
  LazyAllianceDataPage,
  LazyAllianceRankingPage,
  LazyBattleGrabberApp,
  LazyBattleTimelinePage,
  LazyCaptureHubPage,
  LazyComparisonPage,
  LazyDashboard,
  LazyDiagnostics,
  LazyLineupHubPage,
  LazyPlayerProfilePage,
  LazySettingsPage,
  ROUTE_PATHS,
} from "./app/routes";
import { formatErrorMessage } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useAppStore } from "@/store/appStore";
import { useAppData } from "./app/queries";
import { useCaptureEvents } from "./app/useCaptureEvents";
import { useWorkspaceAutoSelect } from "./app/useWorkspaceAutoSelect";
import { useWorkspaceManagement } from "./features/workspace/useWorkspaceManagement";

export function App() {
  // 全局状态只剩 selectedWorkspaceId（Zustand 持久化）；通知全部走 notify（sonner toast，S1-3）
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  // 服务端数据全部由 react-query 按 key 缓存；写操作经 mutation 精确失效驱动更新
  const { bundle, collector, workspaces, isLoading, firstError } = useAppData(selectedWorkspaceId);
  const { activeWorkspace, handleSelectWorkspace } = useWorkspaceManagement();
  // 阶段3b：采集完成事件驱动（capture-session-finished → 精准失效分片 key + toast），App 顶层挂载一次
  useCaptureEvents();

  const scanningActive =
    collector?.runtimeProbe?.busy === true || (bundle?.captureSessions.some((s) => s.status === "running") ?? false);

  // I4：最近一次采集失败时顶栏显示失败态（仅当前工作区最近会话）
  const hasFailedCapture = useMemo(
    () => (bundle?.captureSessions ?? []).some((s) => s.status === "failed"),
    [bundle?.captureSessions],
  );

  // 顶栏「数据新鲜度」：最近一次成功采集的完成时间（ISO 字符串可直接字典序排序）
  const lastCaptureAt = useMemo(() => {
    const finishedAt = (bundle?.captureSessions ?? [])
      .filter((s) => s.status === "completed" && s.finishedAt)
      .map((s) => s.finishedAt as string)
      .sort();
    return finishedAt.length > 0 ? finishedAt[finishedAt.length - 1] : null;
  }, [bundle?.captureSessions]);

  // 初始化成功不打 toast：用户看到内容就是成功反馈。仅保留一次性错误通知。
  const readyRef = useRef(false);
  useEffect(() => {
    if (readyRef.current) return;
    if (firstError) {
      readyRef.current = true;
      notify.error(`初始化失败：${formatErrorMessage(firstError)}`);
      return;
    }
    if (!isLoading && bundle) readyRef.current = true;
  }, [isLoading, firstError, bundle]);

  // 旧 hash（#dashboard / #battleGrabber / #battles 等）已在 main.tsx 模块作用域、
  // HashRouter 初始化前同步归一化（effect 方案与 * 兜底 <Navigate> 在 StrictMode 双效应下竞态，S2-2）

  // 工作区自动选择含 isLoading 守卫：切到未缓存工作区时新 queryKey 的 bundle 未到达、
  // workspaces 短暂为空，守卫跳过清空/回退；数据到达后重跑正常校验（S1-2 审查修复 C1）
  useWorkspaceAutoSelect(workspaces, isLoading);

  return (
    <Routes>
      <Route
        element={
          <AppShell
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            onSelectWorkspace={handleSelectWorkspace}
            scanningActive={scanningActive}
            hasFailedCapture={hasFailedCapture}
            sidecarOnline={collector?.available ?? false}
            lastCaptureAt={lastCaptureAt}
          />
        }
      >
        <Route path="/" element={<Navigate to={ROUTE_PATHS.dashboard} replace />} />
        <Route
          path={ROUTE_PATHS.dashboard}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyDashboard />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.capture}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyCaptureHubPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.alliance}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyAllianceDataPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.battleGrabber}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyBattleGrabberApp
                workspaceContext={
                  activeWorkspace
                    ? {
                        workspaceId: activeWorkspace.id,
                        allianceId: activeWorkspace.allianceId ?? null,
                        allianceName: activeWorkspace.allianceName ?? activeWorkspace.name,
                        allianceGameId: activeWorkspace.allianceGameId ?? null,
                      }
                    : null
                }
              />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.lineups}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyLineupHubPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.ranking}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyAllianceRankingPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.comparison}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyComparisonPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.timeline}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyBattleTimelinePage />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.diagnostics}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyDiagnostics />
            </Suspense>
          }
        />
        <Route
          path={ROUTE_PATHS.settings}
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazySettingsPage />
            </Suspense>
          }
        />
        {/* 参数路由保持字面量：ROUTE_PATHS 只收无参数静态路径；
            avatarId 参数与返回逻辑由 PlayerProfileRoute（PlayerProfilePage.tsx）自取 */}
        <Route
          path="/player/:avatarId"
          element={
            <Suspense fallback={<SuspenseFallback />}>
              <LazyPlayerProfilePage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to={ROUTE_PATHS.dashboard} replace />} />
      </Route>
    </Routes>
  );
}
