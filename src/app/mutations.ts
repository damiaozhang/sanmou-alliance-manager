import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  type CreateWorkspaceRequest,
  type LineupMatchupInput,
  type SaveLineupProfileRequest,
  type SaveMemberBindingRequest,
  type UpsertLineupStatRequest,
  createWorkspace,
  pickExportDirectory,
  resetExportDirectory,
  saveLineupProfile,
  saveMemberBinding,
  saveMemberBindings,
  startCaptureSession,
  stopCaptureSession,
  upsertLineupMatchupsBatch,
  upsertLineupStatsBatch,
} from "../tauri";
import { appKeys, fetchLatestBundle } from "./queries";

// 写操作种类 → 成功后失效的 query key 前缀（纯函数映射表，便于单测）
// pickExportDirectory/resetExportDirectory 不失效：后端返回值即新状态，直接 setQueryData
export type MutationKind =
  | "createWorkspace"
  | "startCaptureSession"
  | "stopCaptureSession"
  | "saveMemberBinding"
  | "saveLineupProfile"
  | "pickExportDirectory"
  | "resetExportDirectory"
  | "export"
  // 阶段4：battle-grabber 融合，批量写操作统一纳入 mutation 体系
  | "syncLineupStats"
  | "syncLineupMatchups"
  | "syncMemberBindings";

// satisfies Record<MutationKind, ...> 提供编译期穷尽保证：新增 MutationKind 而未补
// 映射时 tsc 直接报错，替代运行期 toHaveLength 人工兜底
const invalidationMap = {
  createWorkspace: [["bundle"], ["summary"]],
  startCaptureSession: [["bundle"], ["collector"]],
  stopCaptureSession: [["bundle"], ["collector"]],
  saveMemberBinding: [["bundle"], ["summary"], ["lineupAnalysis"]],
  saveLineupProfile: [["bundle"], ["summary"], ["lineupAnalysis"]],
  pickExportDirectory: [],
  resetExportDirectory: [],
  // 导出可能回写导出记录，保持旧 refresh 后导出记录可见的行为
  export: [["bundle"]],
  // 阵容统计/对阵批量写：失效 lineupAnalysis 与 summary 前缀（跨 wsId 前缀匹配）
  syncLineupStats: [["lineupAnalysis"], ["summary"]],
  syncLineupMatchups: [["lineupAnalysis"]],
  // 批量成员绑定（含战报采集自动绑定）：同 saveMemberBinding 语义
  syncMemberBindings: [["bundle"], ["summary"], ["lineupAnalysis"]],
} satisfies Record<MutationKind, QueryKey[]>;

export function invalidationsFor(kind: MutationKind): QueryKey[] {
  return invalidationMap[kind];
}

// invalidateQueries 的 Promise 在活动 query refetch 完成后才兑现，
// 因此 await 后缓存即为最新，等价于旧 handler 里 await refresh() 的时序
async function applyInvalidations(queryClient: QueryClient, kind: MutationKind) {
  await Promise.all(
    invalidationsFor(kind).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

// CaptureHub 依赖「onStart/onStop 返回时 bundle 已更新」的语义：
// 失效之外再 fetchQuery 一次，双保险保证调用方拿到时缓存已新

export function useCreateWorkspaceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateWorkspaceRequest) => createWorkspace(request),
    onSuccess: () => applyInvalidations(queryClient, "createWorkspace"),
  });
}

export function useStartCaptureSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: number; allianceId: number | null; captureType: string }) =>
      startCaptureSession(vars.workspaceId, vars.allianceId, vars.captureType),
    onSuccess: async (_data, vars) => {
      await applyInvalidations(queryClient, "startCaptureSession");
      await fetchLatestBundle(queryClient, vars.workspaceId);
    },
  });
}

export function useStopCaptureSessionMutation() {
  const queryClient = useQueryClient();
  // wsId 不进 IPC 入参，仅作为变量传递给 onSuccess 用于精确 refetch 对应 bundle
  return useMutation({
    mutationFn: (_wsId: number | null) => stopCaptureSession(),
    onSuccess: async (_data, wsId) => {
      await applyInvalidations(queryClient, "stopCaptureSession");
      await fetchLatestBundle(queryClient, wsId);
    },
  });
}

export function useSaveMemberBindingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveMemberBindingRequest) => saveMemberBinding(request),
    onSuccess: () => applyInvalidations(queryClient, "saveMemberBinding"),
  });
}

export function useSaveLineupProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveLineupProfileRequest) => saveLineupProfile(request),
    onSuccess: () => applyInvalidations(queryClient, "saveLineupProfile"),
  });
}

export function usePickExportDirectoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => pickExportDirectory(),
    onSuccess: (next) => {
      queryClient.setQueryData(appKeys.exportDirectory, next);
    },
  });
}

export function useResetExportDirectoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetExportDirectory(),
    onSuccess: (next) => {
      queryClient.setQueryData(appKeys.exportDirectory, next);
    },
  });
}

// 8 个导出动作共用一个 mutation：exporter 作为变量传入，成功后失效 ["bundle"]
export type ExportVariables = {
  workspaceId: number;
  exporter: (workspaceId: number) => Promise<{ paths: string[] }>;
};

export function useExportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: ExportVariables) => vars.exporter(vars.workspaceId),
    onSuccess: () => applyInvalidations(queryClient, "export"),
  });
}

// ── 阶段4：battle-grabber 融合的批量写 mutation ──

/** 阵容统计批量 upsert（useLineupSync 聚合后写入）。 */
export function useSyncLineupStatsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requests: UpsertLineupStatRequest[]) => upsertLineupStatsBatch(requests),
    onSuccess: () => applyInvalidations(queryClient, "syncLineupStats"),
  });
}

/** 阵容对阵批量 upsert（每场战报一行）。 */
export function useSyncLineupMatchupsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inputs: LineupMatchupInput[]) => upsertLineupMatchupsBatch(inputs),
    onSuccess: () => applyInvalidations(queryClient, "syncLineupMatchups"),
  });
}

/** 批量成员绑定（自动绑定与手动批量绑定共用）。 */
export function useSyncMemberBindingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requests: SaveMemberBindingRequest[]) => saveMemberBindings(requests),
    onSuccess: () => applyInvalidations(queryClient, "syncMemberBindings"),
  });
}
