import { invoke } from "@tauri-apps/api/core";
import { mock, isTauriRuntime } from "./mockState";
export { isTauriRuntime };

// ── IPC 类型来源（S1-5）──
// 镜像 Rust models 的类型全部由 ts-rs 生成（@/lib/bindings，cargo test 重新导出，已入库），
// 本文件只保留：1) 生成类型的 re-export（保持既有 import 方 "@/tauri" 路径不变）；
// 2) 前端窄化/扩展类型（RuntimeProbeStatus、CollectorStatus、AllianceMemberRow/AppBundle 扩展）；
// 3) 34 个 invoke 封装，每个均为单一出口：isTauriRuntime() ? invoke(...) : mock.<fn>()
//    （mock 实现集中在 ./mockState，阶段4 收敛）。
import type {
  AllianceMemberRow as BindingsAllianceMemberRow,
  AppBundle as BindingsAppBundle,
  CollectorStatus as BindingsCollectorStatus,
  WorkspaceSummary,
  WorkspaceRecord,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  CollectorFlowStatus,
  CapturePreviewCounts,
  CaptureManifestArtifactSummary,
  CaptureSessionCapture,
  CaptureSessionSummaryRecord,
  CaptureSessionRow,
  RawArtifactRow,
  MemberSnapshotRow,
  BuildingSnapshotRow,
  AllianceLogRow,
  AllianceFacilityRow,
  AllianceGroupRow,
  BattleReportRow,
  LineupProfileRow,
  MemberBindingRow,
  ComparisonStats,
  ExportJobRow,
  ExportResult,
  ExportDirectoryInfo,
  ExportBattleReportRequest,
  LineupStatRow,
  LineupMatchupRow,
  LineupAnalysisBundle,
  UpsertLineupStatRequest,
  LineupMatchupInput,
  MemberActivityAlertRow,
  MemberActivityAlerts,
  CrossWorkspacePowerPoint,
  BackupResult,
  RestoreResult,
  StartCaptureResponse,
  StopCaptureResponse,
  SaveMemberBindingRequest,
  SaveLineupProfileRequest,
  PagedBattleReports,
  PagedAllianceLogs,
  PagedMemberSnapshots,
  IntelSnapshotRow,
  IntelEntryRow,
  PagedIntelSnapshots,
  PagedIntelEntries,
  AppSnapshotResponse,
  CaptureSessionFinished,
} from "@/lib/bindings";

export type {
  WorkspaceSummary,
  WorkspaceRecord,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  CollectorFlowStatus,
  CapturePreviewCounts,
  CaptureManifestArtifactSummary,
  CaptureSessionCapture,
  CaptureSessionSummaryRecord,
  CaptureSessionRow,
  RawArtifactRow,
  MemberSnapshotRow,
  BuildingSnapshotRow,
  AllianceLogRow,
  AllianceFacilityRow,
  AllianceGroupRow,
  BattleReportRow,
  LineupProfileRow,
  MemberBindingRow,
  ComparisonStats,
  ExportJobRow,
  ExportResult,
  ExportDirectoryInfo,
  ExportBattleReportRequest,
  LineupStatRow,
  LineupMatchupRow,
  LineupAnalysisBundle,
  UpsertLineupStatRequest,
  LineupMatchupInput,
  MemberActivityAlertRow,
  MemberActivityAlerts,
  CrossWorkspacePowerPoint,
  BackupResult,
  RestoreResult,
  StartCaptureResponse,
  StopCaptureResponse,
  SaveMemberBindingRequest,
  SaveLineupProfileRequest,
  PagedBattleReports,
  PagedAllianceLogs,
  PagedMemberSnapshots,
  IntelSnapshotRow,
  IntelEntryRow,
  PagedIntelSnapshots,
  PagedIntelEntries,
  AppSnapshotResponse,
  CaptureSessionFinished,
};

/** 既有别名：Rust 类型名为 CaptureSessionSummaryRecord，前端沿用旧名。 */
export type { CaptureSessionSummaryRecord as CaptureSessionSummary };

/** 前端窄化类型：Rust runtime_probe 为 Option<Value>（bindings 中 unknown），此处细化为已知字段集合。 */
export type RuntimeProbeStatus = {
  enabled?: boolean;
  mode?: string;
  ready?: boolean;
  issues?: string[];
  source?: string;
  outputRoot?: string;
  processConfigured?: string;
  processTarget?: string;
  processFound?: boolean;
  processCandidates?: Array<{ name?: string; pid?: number; source?: string }>;
  commandConfigured?: boolean;
  scriptConfigured?: boolean;
  scriptPath?: string;
  scriptExists?: boolean;
  cwd?: string;
  cwdExists?: boolean;
  python?: string;
  fridaAvailable?: boolean;
  [key: string]: unknown;
};

/** 在 bindings 形状基础上把 runtimeProbe 从 unknown 收窄为 RuntimeProbeStatus。 */
export type CollectorStatus = Omit<BindingsCollectorStatus, "runtimeProbe"> & {
  runtimeProbe?: RuntimeProbeStatus | null;
};

/**
 * 前端扩展字段：joinTs/tFeat/tForageUse/wForageUse/weeklyStatisticsJson 不在 Rust
 * AllianceMemberRow（models.rs）中，runtime 采集路径由 MemberSnapshotRow 提供；
 * 但 AllianceDataPage 的 bundle.allianceMembers 兜底路径与 helpers 防腐层会读取它们
 * （?? 0 兜底），故保留为可选扩展，而非 Rust 镜像的一部分。
 */
export type AllianceMemberRow = BindingsAllianceMemberRow & {
  joinTs?: number;
  tFeat?: number;
  tForageUse?: number;
  wForageUse?: number;
  weeklyStatisticsJson?: string;
};

/** 在 bindings 形状基础上把 allianceMembers 元素换成带前端扩展字段的 AllianceMemberRow。 */
export type AppBundle = Omit<BindingsAppBundle, "allianceMembers"> & {
  allianceMembers: AllianceMemberRow[];
};

export async function getWorkspaceSummary(workspaceId?: number | null): Promise<WorkspaceSummary> {
  return isTauriRuntime() ? invoke("get_workspace_summary", { workspaceId: workspaceId ?? null }) : mock.getWorkspaceSummary();
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  return isTauriRuntime() ? invoke("list_workspaces") : mock.listWorkspaces();
}

export async function getAppBundle(workspaceId?: number | null): Promise<AppBundle> {
  return isTauriRuntime() ? invoke("get_app_bundle", { workspaceId: workspaceId ?? null }) : mock.getAppBundle();
}

export async function exportBundleJson(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_bundle_json", { workspaceId: workspaceId ?? null }) : mock.exportBundleJson();
}

export async function exportBundleCsv(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_bundle_csv", { workspaceId: workspaceId ?? null }) : mock.exportBundleCsv();
}

export async function exportBundleXlsx(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_bundle_xlsx", { workspaceId: workspaceId ?? null }) : mock.exportBundleXlsx();
}

export async function exportBundleHtml(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_bundle_html", { workspaceId: workspaceId ?? null }) : mock.exportBundleHtml();
}

export async function exportBattleReportJson(battleCode: string, workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime()
    ? invoke("export_battle_report_json", { workspaceId: workspaceId ?? null, request: { battleCode } satisfies ExportBattleReportRequest })
    : mock.exportBattleReportJson(battleCode);
}

export async function exportBattleReportHtml(battleCode: string, workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime()
    ? invoke("export_battle_report_html", { workspaceId: workspaceId ?? null, request: { battleCode } satisfies ExportBattleReportRequest })
    : mock.exportBattleReportHtml(battleCode);
}

export async function exportLineupLibraryJson(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_lineup_library_json", { workspaceId: workspaceId ?? null }) : mock.exportLineupLibraryJson();
}

export async function exportLineupLibraryCsv(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_lineup_library_csv", { workspaceId: workspaceId ?? null }) : mock.exportLineupLibraryCsv();
}

export async function exportLineupLibraryHtml(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime() ? invoke("export_lineup_library_html", { workspaceId: workspaceId ?? null }) : mock.exportLineupLibraryHtml();
}

export async function getExportDirectory(): Promise<ExportDirectoryInfo> {
  return isTauriRuntime() ? invoke("get_export_directory") : mock.getExportDirectory();
}

export async function pickExportDirectory(): Promise<ExportDirectoryInfo> {
  return isTauriRuntime() ? invoke("pick_export_directory") : mock.pickExportDirectory();
}

export async function setExportDirectory(path: string): Promise<ExportDirectoryInfo> {
  return isTauriRuntime() ? invoke("set_export_directory", { path }) : mock.setExportDirectory(path);
}

export async function resetExportDirectory(): Promise<ExportDirectoryInfo> {
  return isTauriRuntime() ? invoke("reset_export_directory") : mock.resetExportDirectory();
}

export async function exportAllianceMemberDataCsv(workspaceId?: number | null): Promise<ExportResult> {
  return isTauriRuntime()
    ? invoke("export_alliance_member_data_csv", { workspaceId: workspaceId ?? null })
    : mock.exportAllianceMemberDataCsv();
}

export async function getCollectorStatus(): Promise<CollectorStatus> {
  return isTauriRuntime() ? invoke("get_collector_status") : mock.getCollectorStatus();
}

export async function createWorkspace(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse> {
  return isTauriRuntime() ? invoke("create_workspace", { request }) : mock.createWorkspace(request);
}

export async function startCaptureSession(
  workspaceId: number,
  allianceId: number | null,
  captureType: string
): Promise<StartCaptureResponse> {
  return isTauriRuntime()
    ? invoke("start_capture_session", { request: { workspaceId, allianceId, captureType } })
    : mock.startCaptureSession();
}

export async function stopCaptureSession(): Promise<StopCaptureResponse> {
  return isTauriRuntime() ? invoke("stop_capture_session") : mock.stopCaptureSession();
}

/** 删除一条采集会话历史（含其关联的 raw_artifact 磁盘文件）。 */
export async function deleteCaptureSession(sessionId: number, workspaceId: number): Promise<void> {
  return isTauriRuntime()
    ? invoke("delete_capture_session", { sessionId, workspaceId })
    : mock.deleteCaptureSession(sessionId, workspaceId);
}

export async function saveMemberBinding(request: SaveMemberBindingRequest): Promise<MemberBindingRow | null> {
  return isTauriRuntime() ? invoke("save_member_binding", { request }) : mock.saveMemberBinding(request);
}

export async function saveMemberBindings(requests: SaveMemberBindingRequest[]): Promise<number> {
  return isTauriRuntime() ? invoke("save_member_bindings", { requests }) : mock.saveMemberBindings(requests);
}

export async function saveLineupProfile(request: SaveLineupProfileRequest): Promise<LineupProfileRow> {
  return isTauriRuntime() ? invoke("save_lineup_profile", { request }) : mock.saveLineupProfile(request);
}

export async function upsertLineupStat(request: UpsertLineupStatRequest): Promise<void> {
  return isTauriRuntime() ? invoke("upsert_lineup_stat", { request }) : mock.upsertLineupStat(request);
}

export async function getLineupAnalysis(workspaceId?: number | null): Promise<LineupAnalysisBundle> {
  return isTauriRuntime() ? invoke("get_lineup_analysis", { workspaceId }) : mock.getLineupAnalysis();
}

export async function saveLineupStatNotes(statId: number, notes: string): Promise<void> {
  return isTauriRuntime() ? invoke("save_lineup_stat_notes", { statId, notes }) : mock.saveLineupStatNotes(statId, notes);
}

export async function deleteLineupStat(statId: number): Promise<void> {
  return isTauriRuntime() ? invoke("delete_lineup_stat", { statId }) : mock.deleteLineupStat(statId);
}

// ── 批量写入契约（upsert_lineup_stats / upsert_lineup_matchups） ──

/** 批量写入玩家阵容统计，返回写入条数。 */
export async function upsertLineupStatsBatch(requests: UpsertLineupStatRequest[]): Promise<number> {
  return isTauriRuntime() ? invoke("upsert_lineup_stats", { requests }) : mock.upsertLineupStatsBatch(requests);
}

/** 批量写入阵容对阵记录（每场战报一行），返回写入条数。 */
export async function upsertLineupMatchupsBatch(requests: LineupMatchupInput[]): Promise<number> {
  return isTauriRuntime() ? invoke("upsert_lineup_matchups", { requests }) : mock.upsertLineupMatchupsBatch(requests);
}

// ── 对比统计（get_comparison_stats） ──

export async function getComparisonStats(
  workspaceId: number,
  fromDate: string,
  toDate: string
): Promise<ComparisonStats> {
  return isTauriRuntime() ? invoke("get_comparison_stats", { workspaceId, fromDate, toDate }) : mock.getComparisonStats();
}

// ── 活跃预警（get_member_activity_alerts） ──

export async function getMemberActivityAlerts(
  workspaceId: number,
  offlineDays: number,
  bottomN: number
): Promise<MemberActivityAlerts> {
  return isTauriRuntime()
    ? invoke("get_member_activity_alerts", { workspaceId, offlineDays, bottomN })
    : mock.getMemberActivityAlerts();
}

// ── 跨工作区战力趋势（get_cross_workspace_power_series） ──

export async function getCrossWorkspacePowerSeries(): Promise<CrossWorkspacePowerPoint[]> {
  return isTauriRuntime() ? invoke("get_cross_workspace_power_series", {}) : mock.getCrossWorkspacePowerSeries();
}

// ── 数据备份 / 恢复（backup_data / restore_data） ──

export async function backupData(targetDir: string | null): Promise<BackupResult> {
  return isTauriRuntime() ? invoke("backup_data", { targetDir }) : mock.backupData();
}

export async function restoreData(backupDir: string): Promise<RestoreResult> {
  return isTauriRuntime() ? invoke("restore_data", { backupDir }) : mock.restoreData();
}

// ── 阶段3a 分片命令（大表不再随 get_app_bundle 下发） ──

/** 战报分页（time DESC）；from/to 为 RFC3339，语义 [from, to)，null 表示不限。 */
export async function getBattleReportsPaged(
  workspaceId: number,
  from: string | null,
  to: string | null,
  limit: number,
  offset: number
): Promise<PagedBattleReports> {
  return isTauriRuntime()
    ? invoke("get_battle_reports_paged", { workspaceId, from, to, limit, offset })
    : mock.getBattleReportsPaged(workspaceId, from, to, limit, offset);
}

/** 同盟日志分页（time DESC）；section 为 null 时不过滤分类。 */
export async function getAllianceLogsPaged(
  workspaceId: number,
  section: string | null,
  limit: number,
  offset: number
): Promise<PagedAllianceLogs> {
  return isTauriRuntime()
    ? invoke("get_alliance_logs_paged", { workspaceId, section, limit, offset })
    : mock.getAllianceLogsPaged(workspaceId, section, limit, offset);
}

/** 成员快照分页；latestOnly=true 时每个成员仅最新一行，total 为去重成员数。 */
export async function getMemberSnapshotsPaged(
  workspaceId: number,
  latestOnly: boolean,
  limit: number,
  offset: number
): Promise<PagedMemberSnapshots> {
  return isTauriRuntime()
    ? invoke("get_member_snapshots", { workspaceId, latestOnly, limit, offset })
    : mock.getMemberSnapshotsPaged(workspaceId, latestOnly, limit, offset);
}

/**
 * 同盟情报快照分页（排行榜 / 武将红度 / 赛季战队 / 主公簿 / 同盟建筑 / 同盟历史）。
 * kind 为 null 时不过滤类型。
 */
export async function getIntelSnapshotsPaged(
  workspaceId: number,
  kind: string | null,
  limit: number,
  offset: number
): Promise<PagedIntelSnapshots> {
  return isTauriRuntime()
    ? invoke("get_intel_snapshots", { workspaceId, kind, limit, offset })
    : mock.getIntelSnapshotsPaged(workspaceId, kind, limit, offset);
}

/** 情报快照明细分页（榜单名次 / 战队成员 / 武将红度行）。 */
export async function getIntelEntries(
  workspaceId: number,
  snapshotId: number,
  limit: number,
  offset: number
): Promise<PagedIntelEntries> {
  return isTauriRuntime()
    ? invoke("get_intel_entries", { workspaceId, snapshotId, limit, offset })
    : mock.getIntelEntries(workspaceId, snapshotId, limit, offset);
}

/**
 * battle-grabber 应用快照（带版本协商）：sinceVersion 为上次已知版本，
 * 返回 changed=false 时不携带 snapshot；null 表示强制全量。
 */
export async function getAppSnapshot(sinceVersion?: number | null): Promise<AppSnapshotResponse> {
  return isTauriRuntime() ? invoke("get_app_snapshot", { sinceVersion: sinceVersion ?? null }) : mock.getAppSnapshot();
}
