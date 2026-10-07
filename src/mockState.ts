// 预览模式（浏览器）mock 层（阶段4 收敛）：tauri.ts 每个 wrapper 只做单一出口
// `isTauriRuntime() ? invoke(...) : mock.<fn>()`，全部 mock 实现集中在本文件。

import type {
  WorkspaceSummary,
  WorkspaceRecord,
  AppBundle,
  ExportJobRow,
  ExportResult,
  ExportDirectoryInfo,
  CollectorStatus,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  StartCaptureResponse,
  StopCaptureResponse,
  MemberBindingRow,
  SaveMemberBindingRequest,
  LineupProfileRow,
  SaveLineupProfileRequest,
  UpsertLineupStatRequest,
  LineupStatRow,
  LineupMatchupInput,
  LineupMatchupRow,
  LineupAnalysisBundle,
  ComparisonStats,
  MemberActivityAlerts,
  CrossWorkspacePowerPoint,
  BackupResult,
  RestoreResult,
  PagedBattleReports,
  PagedAllianceLogs,
  PagedMemberSnapshots,
  AppSnapshotResponse,
  BattleReportRow,
  MemberSnapshotRow,
  AllianceLogRow,
  IntelSnapshotRow,
  IntelEntryRow,
  PagedIntelSnapshots,
  PagedIntelEntries,
} from "./tauri";

type MockState = {
  summary: WorkspaceSummary;
  workspaces: WorkspaceRecord[];
  bundle: AppBundle;
  // 阵容统计/对阵的预览内存库：写操作真实落入此处，读操作从这里返回（不再假成功）
  lineupStats: LineupStatRow[];
  lineupMatchups: LineupMatchupRow[];
  exportDirectory: ExportDirectoryInfo;
  // 预览样本数据（previewData.ts 注入）：分片表在浏览器模式下从这里切片返回，
  // 使预览模式能看到真实信息密度。缺省为空数组，单元测试不受影响。
  battleReports: BattleReportRow[];
  memberSnapshots: MemberSnapshotRow[];
  allianceLogs: AllianceLogRow[];
  /** 同盟情报（排行榜/红度/赛季战队/主公簿…）：快照 + 明细，由 previewData.ts 注入 */
  intelSnapshots: IntelSnapshotRow[];
  intelEntries: IntelEntryRow[];
};

export const fallbackSummary: WorkspaceSummary = {
  workspaceCount: 0,
  allianceCount: 0,
  captureSessionCount: 0,
  rawArtifactCount: 0,
  exportJobCount: 0,
  memberSnapshotCount: 0,
  buildingSnapshotCount: 0,
  battleBlockCount: 0,
  lineupProfileCount: 0,
  databasePath: "未连接 Tauri，本页不展示样本数据"
};

const PREVIEW_EXPORT_DIRECTORY: ExportDirectoryInfo = { path: "preview://exports", isCustom: false };

export const mockState: MockState = {
  summary: { ...fallbackSummary },
  workspaces: [],
  bundle: {
    summary: { ...fallbackSummary },
    workspaces: [],
    captureSessions: [],
    rawArtifacts: [],
    exportJobs: [],
    allianceMembers: [],
    allianceFacilities: [],
    allianceGroups: [],
    lineupProfiles: [],
    memberBindings: []
  },
  lineupStats: [],
  lineupMatchups: [],
  exportDirectory: { ...PREVIEW_EXPORT_DIRECTORY },
  battleReports: [],
  memberSnapshots: [],
  intelSnapshots: [],
  intelEntries: [],
  allianceLogs: [],
};

// 预览内存库自增 id（Date.now() 在批量循环中会碰撞，改用单调计数器）
let nextRowId = 1;
function nextId(): number {
  return Date.now() * 1000 + (nextRowId++ % 1000);
}

export function appendPreviewExportJob(jobKind: string, format: string, target: string, outputPaths: string[]) {
  const job: ExportJobRow = {
    id: nextId(),
    createdAt: new Date().toISOString(),
    jobKind,
    format,
    target,
    status: "completed",
    outputPaths
  };
  mockState.summary = {
    ...mockState.summary,
    exportJobCount: mockState.summary.exportJobCount + 1
  };
  mockState.bundle = {
    ...mockState.bundle,
    summary: mockState.summary,
    exportJobs: [job, ...mockState.bundle.exportJobs]
  };
}

export function previewAllianceName() {
  return mockState.bundle.memberBindings[0]?.alliance ?? "青龙盟";
}

export function appendPreviewMemberBinding(request: SaveMemberBindingRequest): MemberBindingRow | null {
  const allianceId = mockState.workspaces[0]?.allianceId;
  if (allianceId == null) {
    // 没有工作区时拒绝写入脏数据（与 useMemberBindingActions 的拦截语义一致）
    return null;
  }
  const row: MemberBindingRow = {
    playerId: nextId(),
    allianceId,
    name: request.avatarName,
    avatar: request.avatarId,
    alliance: previewAllianceName(),
    status: request.confidence,
    updated: new Date().toISOString(),
    isActive: true
  };
  mockState.bundle = {
    ...mockState.bundle,
    memberBindings: [row, ...mockState.bundle.memberBindings]
  };
  return row;
}

export function appendPreviewLineupProfile(request: SaveLineupProfileRequest): LineupProfileRow {
  const heroes = request.heroes.join(" / ");
  const allianceId = mockState.workspaces[0]?.allianceId;
  const row: LineupProfileRow = {
    playerId: nextId(),
    allianceId,
    label: request.label,
    player: request.playerName,
    heroes,
    source: request.sourceBattleId ? `战报 ${request.sourceBattleId}` : "手动固定",
    confidence: request.confidence
  };
  mockState.summary = {
    ...mockState.summary,
    lineupProfileCount: mockState.summary.lineupProfileCount + 1
  };
  mockState.bundle = {
    ...mockState.bundle,
    summary: mockState.summary,
    lineupProfiles: [row, ...mockState.bundle.lineupProfiles]
  };
  return row;
}

/** 阵容统计 upsert（预览内存库）：按 workspace+avatar+lineupKey 定位，存在则覆盖。 */
function upsertPreviewLineupStat(request: UpsertLineupStatRequest): LineupStatRow {
  const observedAt = new Date().toISOString();
  const existing = mockState.lineupStats.find(
    (s) => s.workspaceId === request.workspaceId && s.avatarId === request.avatarId && s.lineupKey === request.lineupKey,
  );
  const row: LineupStatRow = {
    ...request,
    id: existing?.id ?? nextId(),
    heroIdsJson: JSON.stringify(request.heroIds),
    heroLevelsJson: JSON.stringify(request.heroLevels),
    observedAt,
  };
  mockState.lineupStats = existing
    ? mockState.lineupStats.map((s) => (s.id === existing.id ? row : s))
    : [row, ...mockState.lineupStats];
  return row;
}

/** 阵容对阵追加（预览内存库）：按 battleCode+双方 avatar 去重。 */
function appendPreviewLineupMatchup(input: LineupMatchupInput): LineupMatchupRow {
  const existing = mockState.lineupMatchups.find(
    (m) =>
      m.workspaceId === input.workspaceId &&
      m.battleCode === input.battleCode &&
      m.attackerAvatarId === input.attackerAvatarId &&
      m.defenderAvatarId === input.defenderAvatarId,
  );
  if (existing) return existing;
  const row: LineupMatchupRow = { ...input, id: nextId(), observedAt: new Date().toISOString() };
  mockState.lineupMatchups = [row, ...mockState.lineupMatchups];
  return row;
}

const browserCollectorStatus: CollectorStatus = {
  available: false,
  mode: "browser",
  message: "浏览器模式未连接 Tauri sidecar，不执行 runtime 采集",
  captureFlows: {
    alliance_data: {
      flow: "alliance_runtime",
      expectedArtifacts: ["rpc_dump", "ui_snapshot", "static_config"],
      navigation: ["同盟首页", "成员列表", "成员详情", "日志分类", "设施科技", "辎重运输", "排行榜"],
      nextProbe: "__install_alliance_rpc_hooks__",
      preview: undefined
    },
    battle_passive: {
      flow: "battle_listener",
      expectedArtifacts: ["battle_block_list", "battle_detail", "battle_environment"],
      navigation: ["战报入口", "战报列表", "子战斗", "详情", "固定阵容"],
      nextProbe: "__install_battle_listener_hooks__",
      preview: undefined
    }
  }
};

/**
 * 预览模式 mock 出口表：tauri.ts 的每个 wrapper 在此都有对应实现。
 * 写操作真实变更 mockState（不再静默 no-op），读操作从 mockState 派生。
 */
export const mock = {
  getWorkspaceSummary(): WorkspaceSummary {
    return mockState.summary;
  },
  listWorkspaces(): WorkspaceRecord[] {
    return mockState.workspaces;
  },
  getAppBundle(): AppBundle {
    // 返回浅拷贝，避免调用方直接改写 mockState 内部数组（防御共享引用突变）
    return {
      ...mockState.bundle,
      workspaces: [...mockState.bundle.workspaces],
      captureSessions: [...mockState.bundle.captureSessions],
      rawArtifacts: [...mockState.bundle.rawArtifacts],
      exportJobs: [...mockState.bundle.exportJobs],
      allianceMembers: [...mockState.bundle.allianceMembers],
      allianceFacilities: [...mockState.bundle.allianceFacilities],
      allianceGroups: [...mockState.bundle.allianceGroups],
      lineupProfiles: [...mockState.bundle.lineupProfiles],
      memberBindings: [...mockState.bundle.memberBindings],
    };
  },
  exportBundleJson(): ExportResult {
    appendPreviewExportJob("bundle", "json", "workspace-bundle", ["preview://bundle.json"]);
    return { kind: "bundle", format: "json", paths: ["preview://bundle.json"] };
  },
  exportBundleCsv(): ExportResult {
    const paths = ["preview://members.csv", "preview://battles.csv", "preview://sessions.csv", "preview://raw-artifacts.csv"];
    appendPreviewExportJob("bundle", "csv", "workspace-bundle", paths);
    return { kind: "bundle", format: "csv", paths };
  },
  exportBundleXlsx(): ExportResult {
    appendPreviewExportJob("bundle", "xlsx", "workspace-bundle", ["preview://bundle.xlsx"]);
    return { kind: "bundle", format: "xlsx", paths: ["preview://bundle.xlsx"] };
  },
  exportBundleHtml(): ExportResult {
    appendPreviewExportJob("bundle", "html", "workspace-bundle", ["preview://bundle.html"]);
    return { kind: "bundle", format: "html", paths: ["preview://bundle.html"] };
  },
  exportBattleReportJson(battleCode: string): ExportResult {
    const paths = [`preview://battle-report-${battleCode}.json`];
    appendPreviewExportJob("battle_report", "json", battleCode, paths);
    return { kind: "battle_report", format: "json", paths };
  },
  exportBattleReportHtml(battleCode: string): ExportResult {
    const paths = [`preview://battle-report-${battleCode}.html`];
    appendPreviewExportJob("battle_report", "html", battleCode, paths);
    return { kind: "battle_report", format: "html", paths };
  },
  exportLineupLibraryJson(): ExportResult {
    appendPreviewExportJob("lineup_library", "json", "workspace-lineup-library", ["preview://lineup-library.json"]);
    return { kind: "lineup_library", format: "json", paths: ["preview://lineup-library.json"] };
  },
  exportLineupLibraryCsv(): ExportResult {
    appendPreviewExportJob("lineup_library", "csv", "workspace-lineup-library", ["preview://lineup-library.csv"]);
    return { kind: "lineup_library", format: "csv", paths: ["preview://lineup-library.csv"] };
  },
  exportLineupLibraryHtml(): ExportResult {
    appendPreviewExportJob("lineup_library", "html", "workspace-lineup-library", ["preview://lineup-library.html"]);
    return { kind: "lineup_library", format: "html", paths: ["preview://lineup-library.html"] };
  },
  exportAllianceMemberDataCsv(): ExportResult {
    appendPreviewExportJob("alliance_member_data", "csv", "game-alliance-member-data", ["preview://alliance-member-data.csv"]);
    return { kind: "alliance_member_data", format: "csv", paths: ["preview://alliance-member-data.csv"] };
  },
  getExportDirectory(): ExportDirectoryInfo {
    return mockState.exportDirectory;
  },
  pickExportDirectory(): ExportDirectoryInfo {
    // 浏览器无法打开系统目录对话框：保持预览目录并如实标记非自定义
    mockState.exportDirectory = { ...PREVIEW_EXPORT_DIRECTORY };
    return mockState.exportDirectory;
  },
  setExportDirectory(path: string): ExportDirectoryInfo {
    mockState.exportDirectory = { path, isCustom: true };
    return mockState.exportDirectory;
  },
  resetExportDirectory(): ExportDirectoryInfo {
    mockState.exportDirectory = { ...PREVIEW_EXPORT_DIRECTORY };
    return mockState.exportDirectory;
  },
  getCollectorStatus(): CollectorStatus {
    return browserCollectorStatus;
  },
  createWorkspace(request: CreateWorkspaceRequest): CreateWorkspaceResponse {
    // P2-2 修复：改用单调 nextId()（原 Date.now() 批量/快速创建会碰撞）
    const id = nextId();
    const allianceId = id + 1;
    const workspace: WorkspaceRecord = {
      id,
      name: request.name,
      serverName: request.serverName,
      seasonName: request.seasonName,
      allianceId,
      allianceName: request.allianceName,
      allianceGameId: request.allianceGameId ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newWorkspaces = [workspace, ...mockState.workspaces];
    const newSummary = {
      ...mockState.summary,
      workspaceCount: newWorkspaces.length,
      allianceCount: newWorkspaces.length,
      databasePath: "浏览器预览模式内存数据",
    };
    Object.assign(mockState, {
      summary: newSummary,
      workspaces: newWorkspaces,
      bundle: { ...mockState.bundle, summary: newSummary, workspaces: newWorkspaces },
    });
    return { workspace, allianceId };
  },
  startCaptureSession(): StartCaptureResponse {
    const now = new Date().toISOString();
    // P2-2 修复：改用单调 nextId()，避免与其它 mock 写入碰撞
    const sessionId = nextId();
    const captureType = "alliance_data";
    // P1-1 修复：预览模式也真实落一条 failed 会话，避免前端乐观会话
    // 永久挂在 running（bundle 里永远等不到同 id 会话导致 15s 兜底轮询空转）。
    const failedSession: AppBundle["captureSessions"][number] = {
      id: sessionId,
      captureType,
      status: "failed",
      startedAt: now,
      finishedAt: now,
      summaryJson: JSON.stringify({
        status: "failed",
        note: "浏览器模式不会生成模拟采集数据；请在 Tauri 桌面应用中启动 runtime 采集",
        finishedAt: now,
        capture: { runtime: { status: "failed", recordCount: 0 } },
      }),
    };
    mockState.bundle = {
      ...mockState.bundle,
      captureSessions: [failedSession, ...mockState.bundle.captureSessions],
    };
    return {
      sessionId,
      status: "failed",
      startedAt: now,
      message: "浏览器模式不会生成模拟采集数据；请在 Tauri 桌面应用中启动 runtime 采集"
    };
  },
  stopCaptureSession(): StopCaptureResponse {
    const stoppedAt = new Date().toISOString();
    let closedSessions = 0;
    const updatedSessions = mockState.bundle.captureSessions.map((session) => {
      if (session.status !== "running") return session;
      closedSessions += 1;
      return {
        ...session,
        status: "failed" as const,
        finishedAt: stoppedAt,
        summaryJson: JSON.stringify({ ...(session.summary ?? {}), status: "failed", note: "用户停止采集", finishedAt: stoppedAt }),
        summary: session.summary ? { ...session.summary, status: "failed", note: "用户停止采集" } : session.summary,
      };
    });
    mockState.bundle = { ...mockState.bundle, captureSessions: updatedSessions };
    return {
      stopped: closedSessions > 0,
      closedSessions,
      message: closedSessions > 0 ? `浏览器预览模式已停止 ${closedSessions} 个采集会话` : "当前没有正在运行的采集",
    };
  },
  deleteCaptureSession(sessionId: number, _workspaceId: number): void {
    mockState.bundle = {
      ...mockState.bundle,
      captureSessions: mockState.bundle.captureSessions.filter((s) => s.id !== sessionId),
      // rawArtifacts 只保留属于其它会话的（预览模式下 artifact 与 session 的
      // capture_session_id 关联）
      rawArtifacts: mockState.bundle.rawArtifacts.filter((a) => a.captureSessionId !== sessionId),
    };
  },
  saveMemberBinding(request: SaveMemberBindingRequest): MemberBindingRow | null {
    return appendPreviewMemberBinding(request);
  },
  saveMemberBindings(requests: SaveMemberBindingRequest[]): number {
    let written = 0;
    for (const r of requests) {
      if (appendPreviewMemberBinding(r)) written += 1;
    }
    return written;
  },
  saveLineupProfile(request: SaveLineupProfileRequest): LineupProfileRow {
    return appendPreviewLineupProfile(request);
  },
  /** 预览模式真实写入内存库（修复旧版静默 no-op 假成功）。 */
  upsertLineupStat(request: UpsertLineupStatRequest): void {
    upsertPreviewLineupStat(request);
  },
  getLineupAnalysis(): LineupAnalysisBundle {
    return { stats: mockState.lineupStats, matchups: mockState.lineupMatchups };
  },
  saveLineupStatNotes(statId: number, notes: string): void {
    mockState.lineupStats = mockState.lineupStats.map((s) => (s.id === statId ? { ...s, notes } : s));
  },
  deleteLineupStat(statId: number): void {
    mockState.lineupStats = mockState.lineupStats.filter((s) => s.id !== statId);
  },
  upsertLineupStatsBatch(requests: UpsertLineupStatRequest[]): number {
    for (const r of requests) upsertPreviewLineupStat(r);
    return requests.length;
  },
  upsertLineupMatchupsBatch(inputs: LineupMatchupInput[]): number {
    let written = 0;
    for (const input of inputs) {
      const before = mockState.lineupMatchups.length;
      appendPreviewLineupMatchup(input);
      if (mockState.lineupMatchups.length > before) written += 1;
    }
    return written;
  },
  getComparisonStats(): ComparisonStats {
    // 从预览内存态如实派生（无数据源时为 0），不再与真实路径双源
    const memberNames = new Set(mockState.bundle.allianceMembers.map((m) => m.name));
    return {
      members: memberNames.size,
      buildings: mockState.bundle.allianceFacilities.length,
      battles: mockState.battleReports.length,
      sessions: mockState.bundle.captureSessions.length,
    };
  },
  getMemberActivityAlerts(): MemberActivityAlerts {
    return { offlineMembers: [], lowContribution: [] };
  },
  getCrossWorkspacePowerSeries(): CrossWorkspacePowerPoint[] {
    return [];
  },
  backupData(): BackupResult {
    return { path: "", bytes: 0 };
  },
  restoreData(): RestoreResult {
    return { staged: false, message: "浏览器预览模式不支持备份恢复，请在桌面应用中操作。" };
  },
  /**
   * 分片表在浏览器模式下从预览样本数据切片返回（真实 limit/offset/total 语义），
   * 而不是固定返回空数组——否则预览模式所有页面都只能是空态，无法评估信息密度。
   * from/to 为 ISO 字符串，闭区间；time DESC 排序与真实实现一致。
   */
  getBattleReportsPaged(
    workspaceId: number,
    from: string | null,
    to: string | null,
    limit: number,
    offset: number,
  ): PagedBattleReports {
    const rows = mockState.battleReports
      .filter((r) => r.workspaceId == null || r.workspaceId === workspaceId)
      .filter((r) => (from ? r.time >= from : true) && (to ? r.time <= to : true))
      .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  getAllianceLogsPaged(
    workspaceId: number,
    section: string | null,
    limit: number,
    offset: number,
  ): PagedAllianceLogs {
    const rows = mockState.allianceLogs
      .filter((r) => section == null || r.section === section)
      .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  getMemberSnapshotsPaged(
    workspaceId: number,
    latestOnly: boolean,
    limit: number,
    offset: number,
  ): PagedMemberSnapshots {
    let rows = mockState.memberSnapshots;
    if (latestOnly) {
      // 每个 avatarId 只保留 observedAt 最新的一行，与真实实现的去重语义一致
      const latest = new Map<string, MemberSnapshotRow>();
      for (const r of rows) {
        const prev = latest.get(r.avatarId);
        if (!prev || r.observedAt > prev.observedAt) latest.set(r.avatarId, r);
      }
      rows = [...latest.values()];
    }
    const sorted = [...rows].sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
    return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
  },
  getAppSnapshot(): AppSnapshotResponse {
    return { changed: false, version: 0 };
  },
  /**
   * 情报快照分页。`kind` 为 null 不过滤；排序与真实实现一致（observedAt DESC，id DESC）。
   * `payloadJson` 在真实实现里不随分页返回，预览同样只返回指标与源函数。
   */
  getIntelSnapshotsPaged(
    _workspaceId: number,
    kind: string | null,
    limit: number,
    offset: number,
  ): PagedIntelSnapshots {
    const rows = mockState.intelSnapshots
      .filter((row) => !kind || row.kind === kind)
      .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : b.id - a.id));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  getIntelEntries(
    _workspaceId: number,
    snapshotId: number,
    limit: number,
    offset: number,
  ): PagedIntelEntries {
    const rows = mockState.intelEntries
      .filter((row) => row.snapshotId === snapshotId)
      // rank > 0 的按名次升序排在前面，与后端 ORDER BY 保持一致
      .sort((a, b) => {
        const aRanked = a.rank > 0 ? 0 : 1;
        const bRanked = b.rank > 0 ? 0 : 1;
        return aRanked - bRanked || a.rank - b.rank || a.id - b.id;
      });
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
};

export { isTauriRuntime } from "@/lib/runtime";

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function csvCell(value: string) {
  const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n");
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function buildCsv(headers: string[], rows: string[][]) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
