import { useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  type AppBundle,
  type LineupAnalysisBundle,
  type PagedAllianceLogs,
  type PagedBattleReports,
  type PagedMemberSnapshots,
  type WorkspaceRecord,
  getAppBundle,
  getAllianceLogsPaged,
  getBattleReportsPaged,
  getCollectorStatus,
  getExportDirectory,
  getLineupAnalysis,
  getMemberSnapshotsPaged,
  getIntelSnapshotsPaged,
  getIntelEntries,
  getWorkspaceSummary,
} from "../tauri";

// 服务端数据 query key 登记表：写操作按前缀失效（["bundle"] 匹配所有 wsId 变体）
export const appKeys = {
  bundle: (wsId: number | null) => ["bundle", wsId] as const,
  summary: (wsId: number | null) => ["summary", wsId] as const,
  collector: ["collector"] as const,
  exportDirectory: ["exportDirectory"] as const,
  lineupAnalysis: (wsId: number | null) => ["lineupAnalysis", wsId] as const,
  // 阶段3b 分片域 key：大表不再随 bundle 下发，按域精准失效
  battleReports: (wsId: number | null, params: { from?: string | null; to?: string | null; limit: number; offset: number }) =>
    ["battleReports", wsId, params] as const,
  allianceLogs: (wsId: number | null, section: string | null, page: { limit: number; offset: number }) =>
    ["allianceLogs", wsId, section, page] as const,
  memberSnapshots: (wsId: number | null, latestOnly: boolean, page: { limit: number; offset: number }) =>
    ["memberSnapshots", wsId, latestOnly, page] as const,
  intelSnapshots: (wsId: number | null, kind: string | null, page: { limit: number; offset: number }) =>
    ["intelSnapshots", wsId, kind, page] as const,
  intelEntries: (wsId: number | null, snapshotId: number, page: { limit: number; offset: number }) =>
    ["intelEntries", wsId, snapshotId, page] as const,
  appSnapshot: ["appSnapshot"] as const,
};

// 空态用模块级常量，保证引用稳定，避免下游 React.memo 页面无谓重渲染
const EMPTY_LINEUP_ANALYSIS: LineupAnalysisBundle = { stats: [], matchups: [] };
const EMPTY_WORKSPACES: WorkspaceRecord[] = [];

// 组合 5 个 useQuery 提供 App 全部服务端数据；staleTime 默认 0（与旧 refresh()「总是新鲜」一致）
// wsId 允许 null，queryFn 直传，与旧 getAppBundle(null) 行为一致
export function useAppData(workspaceId: number | null) {
  const bundleQuery = useQuery({
    queryKey: appKeys.bundle(workspaceId),
    queryFn: () => getAppBundle(workspaceId),
  });
  const summaryQuery = useQuery({
    queryKey: appKeys.summary(workspaceId),
    queryFn: () => getWorkspaceSummary(workspaceId),
  });
  const collectorQuery = useQuery({
    queryKey: appKeys.collector,
    queryFn: () => getCollectorStatus(),
  });
  const exportDirectoryQuery = useQuery({
    queryKey: appKeys.exportDirectory,
    queryFn: () => getExportDirectory(),
  });
  const lineupAnalysisQuery = useQuery({
    queryKey: appKeys.lineupAnalysis(workspaceId),
    queryFn: () => getLineupAnalysis(workspaceId),
  });

  const bundle = bundleQuery.data ?? null;
  const queries = [bundleQuery, summaryQuery, collectorQuery, exportDirectoryQuery, lineupAnalysisQuery];
  return {
    bundle,
    summary: summaryQuery.data ?? null,
    collector: collectorQuery.data ?? null,
    exportDirectory: exportDirectoryQuery.data ?? null,
    lineupAnalysis: lineupAnalysisQuery.data ?? EMPTY_LINEUP_ANALYSIS,
    workspaces: bundle?.workspaces ?? EMPTY_WORKSPACES,
    isLoading: queries.some((q) => q.isLoading),
    firstError: (queries.find((q) => q.error)?.error ?? null) as Error | null,
  };
}

// 强制拉取最新 bundle 并写入缓存；staleTime 0 保证总是真拉取。
// 供 useRefreshAppData 与 capture 类 mutation onSuccess 复用
export function fetchLatestBundle(queryClient: QueryClient, wsId: number | null) {
  return queryClient.fetchQuery({
    queryKey: appKeys.bundle(wsId),
    queryFn: () => getAppBundle(wsId),
    staleTime: 0,
  });
}

// 全量刷新：显式列出受影响 key（bundle/summary/lineupAnalysis 按 wsId 精准失效 + 全局 collector/exportDirectory，
// 分片域用前缀失效当前 wsId 变体），再 fetchQuery 取最新 bundle。
// 返回最新 bundle 的契约是 CaptureHub 判断 session running 态的生命线，不许退化成 void。
export function useRefreshAppData() {
  const queryClient = useQueryClient();
  return useCallback(
    async (wsId?: number | null): Promise<AppBundle | null> => {
      const w = wsId ?? null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appKeys.bundle(w) }),
        queryClient.invalidateQueries({ queryKey: appKeys.summary(w) }),
        queryClient.invalidateQueries({ queryKey: appKeys.lineupAnalysis(w) }),
        queryClient.invalidateQueries({ queryKey: ["battleReports", w] }),
        queryClient.invalidateQueries({ queryKey: ["allianceLogs", w] }),
        queryClient.invalidateQueries({ queryKey: ["memberSnapshots", w] }),
        queryClient.invalidateQueries({ queryKey: appKeys.collector }),
        queryClient.invalidateQueries({ queryKey: appKeys.exportDirectory }),
      ]);
      return fetchLatestBundle(queryClient, w);
    },
    [queryClient],
  );
}

// ── 阶段3b 分片查询 hooks（服务端分页，placeholderData 保留上一页避免闪烁） ──

export interface BattleReportsPagedParams {
  from?: string | null;
  to?: string | null;
  limit: number;
  offset: number;
}

/** 战报分页（time DESC，RFC3339 [from, to)）。workspaceId 为 null 时禁用。 */
export function useBattleReportsPaged(workspaceId: number | null, params: BattleReportsPagedParams) {
  return useQuery({
    queryKey: appKeys.battleReports(workspaceId, params),
    queryFn: () => getBattleReportsPaged(workspaceId as number, params.from ?? null, params.to ?? null, params.limit, params.offset),
    enabled: workspaceId !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** 同盟日志分页（time DESC）；section 为 null 不过滤分类。 */
export function useAllianceLogsPaged(workspaceId: number | null, section: string | null, page: { limit: number; offset: number }) {
  return useQuery({
    queryKey: appKeys.allianceLogs(workspaceId, section, page),
    queryFn: () => getAllianceLogsPaged(workspaceId as number, section, page.limit, page.offset),
    enabled: workspaceId !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** 成员快照分页；latestOnly=true 时 total 为去重成员数。 */
export function useMemberSnapshotsPaged(workspaceId: number | null, latestOnly: boolean, page: { limit: number; offset: number }) {
  return useQuery({
    queryKey: appKeys.memberSnapshots(workspaceId, latestOnly, page),
    queryFn: () => getMemberSnapshotsPaged(workspaceId as number, latestOnly, page.limit, page.offset),
    enabled: workspaceId !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** 情报快照分页（排行榜/红度/赛季战队/主公簿…）。kind 为 null 不过滤类型。 */
export function useIntelSnapshotsPaged(workspaceId: number | null, kind: string | null, page: { limit: number; offset: number }) {
  return useQuery({
    queryKey: appKeys.intelSnapshots(workspaceId, kind, page),
    queryFn: () => getIntelSnapshotsPaged(workspaceId as number, kind, page.limit, page.offset),
    enabled: workspaceId !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** 情报快照明细分页；snapshotId 为 null 时禁用（避免用 0 误查）。 */
export function useIntelEntries(workspaceId: number | null, snapshotId: number | null, page: { limit: number; offset: number }) {
  return useQuery({
    queryKey: appKeys.intelEntries(workspaceId, snapshotId ?? 0, page),
    queryFn: () => getIntelEntries(workspaceId as number, snapshotId as number, page.limit, page.offset),
    enabled: workspaceId !== null && snapshotId !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * P1-3 修复：全量成员快照历史（latestOnly=false，按 total 循环分页拉取）。
 * 替代原先固定 2000 条上限——数据量大时历史窗口外的快照被截断，
 * 导致"离盟/新入盟"判定静默错误。limit 500/页，最多拉 100 页（5 万行）防护。
 * 2026-08-08 备注：曾担心全量加载撑爆 WebView2，实测当前最大工作区 6182 行
 * （522 成员 × 单成员最多 32 行历史），且后端已用 '{}' 替换 raw_json 大字段、
 * 每行仅精简列（~几百字节），IPC 传输仅几 MB，非崩溃主因；40 页（2 万行）上限
 * 反而会在数据继续增长时重现 P1-3 的截断问题，故上调至 100 页作为护栏。
 */
export function useAllMemberSnapshots(workspaceId: number | null) {
  return useQuery<PagedMemberSnapshots["rows"]>({
    queryKey: ["memberSnapshotsAll", workspaceId] as const,
    queryFn: async () => {
      const pageSize = 500;
      const maxPages = 100;
      const all: PagedMemberSnapshots["rows"] = [];
      for (let page = 0; page < maxPages; page++) {
        const result = await getMemberSnapshotsPaged(workspaceId as number, false, pageSize, page * pageSize);
        all.push(...result.rows);
        if (all.length >= result.total) break;
      }
      return all;
    },
    enabled: workspaceId !== null,
    staleTime: 60_000,
  });
}

export type { PagedBattleReports, PagedAllianceLogs, PagedMemberSnapshots };
