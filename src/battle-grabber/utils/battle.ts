import type {
  JsonRecord, BattleAttr, BattleSkill, BattleWarbook, BattleHeroDetail,
  BattleTeamDetail, BattleDetails, ReportRecord, SummaryPair, TopUnitSummary,
  AppSnapshot, LiveCaptureSnapshot, BridgeEventPayload, LogEntry, PacketRecord,
} from "../types";
import { AUTHORITATIVE_SKILL_NAMES, AUTHORITATIVE_WARBOOK_NAMES, AUTHORITATIVE_EQUIPMENT_NAMES, AUTHORITATIVE_HORSE_NAMES, ALLIANCE_HERO_NAMES, AUTHORITATIVE_FORMATION_NAMES } from "../constants";
import { asRecord, asArray, asString, asNumber, asId, asBoolean, appendLimited, appendLimitedMany, getObjectField } from "./helpers";
import { lookupTerm } from "./format";

// ── Runtime type guards for untrusted bridge events ──
// BridgeEventPayload 来自 IPC 流式推送，形状不可信，需最小运行时验证后再收纳入 snapshot。
function isPacketRecord(value: unknown): value is PacketRecord {
  const r = asRecord(value);
  if (!r) return false;
  // 关键标识字段：sessionId 必须为非空字符串，seq 必须为有限数字
  return typeof r["sessionId"] === "string" && r["sessionId"].length > 0
    && typeof r["seq"] === "number" && Number.isFinite(r["seq"]);
}

function isReportRecord(value: unknown): value is ReportRecord {
  const r = asRecord(value);
  if (!r) return false;
  // 关键标识字段：sessionId 与 id 必须为非空字符串（reportKey 依赖二者拼接）
  return typeof r["sessionId"] === "string" && r["sessionId"].length > 0
    && typeof r["id"] === "string" && r["id"].length > 0;
}

// ── Battle parsing ──

export function parseBattleAttr(value: unknown): BattleAttr | null {
  const r = asRecord(value);
  if (!r) return null;
  const key = asString(r["key"]);
  const label = asString(r["label"]) || key;
  const v = asId(r["value"]);
  const name = asString(r["name"]);
  if (!key && !label && !v && !name) return null;
  return { key, label, value: v, name };
}

export function parseBattleSkill(value: unknown): BattleSkill | null {
  const r = asRecord(value);
  if (!r) return null;
  const skillId = asId(r["skillId"]);
  const name = asString(r["name"]) || lookupTerm(AUTHORITATIVE_SKILL_NAMES, skillId);
  if (!skillId && !name) return null;
  return { skillId, name, level: asNumber(r["level"]), orderLevel: asNumber(r["orderLevel"]), position: asNumber(r["position"]), showReplace: asBoolean(r["showReplace"]) };
}

export function parseBattleWarbook(value: unknown): BattleWarbook | null {
  const r = asRecord(value);
  if (!r) return null;
  const warbookId = asId(r["warbookId"]);
  const name = asString(r["name"]) || lookupTerm(AUTHORITATIVE_WARBOOK_NAMES, warbookId);
  if (!warbookId && !name) return null;
  return { warbookId, name };
}

export function parseBattleHero(value: unknown): BattleHeroDetail | null {
  const r = asRecord(value);
  if (!r) return null;
  const equipment = asRecord(r["equipment"]) ?? {};
  const horse = asRecord(r["horse"]) ?? {};
  const heroId = asId(r["heroId"]);
  const name = asString(r["name"]);
  const displayName = allianceHeroNameFromRecord(r);
  return {
    heroId, name, displayName,
    position: asNumber(r["position"]), group: asNumber(r["group"]),
    basicArmsId: asNumber(r["basicArmsId"]), basicArmsName: asString(r["basicArmsName"]),
    level: asNumber(r["level"]), evolution: asNumber(r["evolution"]), enlighten: asNumber(r["enlighten"]),
    originTroops: asNumber(r["originTroops"]), armyTroops: asNumber(r["armyTroops"]),
    remainingTroops: asNumber(r["remainingTroops"]), dead: asNumber(r["dead"]), wounded: asNumber(r["wounded"]),
    skills: asArray(r["skills"]).slice(0, 3).map(parseBattleSkill).filter((s): s is BattleSkill => s !== null),
    warbooks: asArray(r["warbooks"]).map(parseBattleWarbook).filter((w): w is BattleWarbook => w !== null),
    warbookItemId: asId(r["warbookItemId"]),
    equipment: {
      equipId: asId(equipment["equipId"]),
      name: asString(equipment["name"]) || lookupTerm(AUTHORITATIVE_EQUIPMENT_NAMES, equipment["equipId"]),
      attrs: asArray(equipment["attrs"]).map(parseBattleAttr).filter((a): a is BattleAttr => a !== null),
    },
    horse: {
      horseId: asId(horse["horseId"]),
      name: asString(horse["name"]) || lookupTerm(AUTHORITATIVE_HORSE_NAMES, horse["horseId"]),
      attrs: asArray(horse["attrs"]).map(parseBattleAttr).filter((a): a is BattleAttr => a !== null),
    },
  };
}

function allianceHeroNameFromRecord(hero: JsonRecord): string {
  const heroId = asId(hero["heroId"]);
  const mapped = heroId ? ALLIANCE_HERO_NAMES[heroId] : "";
  if (mapped) return mapped;
  const dn = asString(hero["displayName"]);
  if (dn && !/^#?\d+$/.test(dn) && !/^武将\s*#?\d+$/.test(dn)) return dn;
  const n = asString(hero["name"]);
  if (n && !/^#?\d+$/.test(n) && !/^武将\s*#?\d+$/.test(n)) return n;
  return heroId ? `未识别武将 ${heroId}` : "未知武将";
}

function parseTeamTotals(value: unknown): BattleTeamDetail["totals"] {
  const r = asRecord(value) ?? {};
  return {
    originTroops: asNumber(r["originTroops"]) ?? 0,
    remainingTroops: asNumber(r["remainingTroops"]) ?? 0,
    dead: asNumber(r["dead"]) ?? 0,
    wounded: asNumber(r["wounded"]) ?? 0,
  };
}

export function parseBattleTeam(value: unknown): BattleTeamDetail | null {
  const r = asRecord(value);
  if (!r) return null;
  const player = asRecord(r["player"]) ?? {};
  return {
    side: asString(r["side"]), label: asString(r["label"]),
    armyId: asId(r["armyId"]), winner: asBoolean(r["winner"]),
    leaderHeroId: asId(r["leaderHeroId"]),
    player: {
      avatarId: asId(player["avatarId"]), name: asString(player["name"]),
      allianceId: asId(player["allianceId"]), allianceName: asString(player["allianceName"]),
      faction: asNumber(player["faction"]), bornStateId: asNumber(player["bornStateId"]),
    },
    formationId: asId(r["formationId"]),
    formationName: asString(r["formationName"]) || AUTHORITATIVE_FORMATION_NAMES[asId(r["formationId"])] || "",
    morale: asNumber(r["morale"]), originZgNum: asNumber(r["originZgNum"]),
    zgNum: asNumber(r["zgNum"]), totalTroopNum: asNumber(r["totalTroopNum"]),
    nowTroopNum: asNumber(r["nowTroopNum"]),
    heroes: asArray(r["heroes"]).map(parseBattleHero).filter((h): h is BattleHeroDetail => h !== null),
    totals: parseTeamTotals(r["totals"]),
  };
}

export function parseBattleDetails(value: unknown): BattleDetails | null {
  const r = asRecord(value);
  if (!r) return null;
  const attacker = parseBattleTeam(r["attacker"]);
  const defender = parseBattleTeam(r["defender"]);
  if (!attacker && !defender) return null;
  return {
    schema: asString(r["schema"]), source: asString(r["source"]),
    battleId: asId(r["battleId"]), matchType: asNumber(r["matchType"]),
    combatType: asNumber(r["combatType"]), scenarioId: asNumber(r["scenarioId"]),
    endRound: asNumber(r["endRound"]), winnerArmyId: asId(r["winnerArmyId"]),
    location: asArray(r["location"]), attacker, defender,
  };
}

// ── Report helpers ──

export function reportKey(report: ReportRecord): string {
  return `${report.sessionId}:${report.id}`;
}

export function getReportPrimaryPath(report: ReportRecord): string {
  return report.json || report.battleJson || report.txt || report.battleMd || report.md || report.csv || report.html;
}

export function getReportJsonPath(report: ReportRecord): string {
  return report.json || report.battleJson || "";
}

export function getReportTextPath(report: ReportRecord): string {
  return report.txt || report.battleMd || report.md || "";
}

export function getReportAiPath(report: ReportRecord): string {
  return report.battleMd || report.battleJson || "";
}

export function getReportFolder(report: ReportRecord): string {
  const filePath = getReportPrimaryPath(report);
  const sep = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return sep > 0 ? filePath.slice(0, sep) : "";
}

export function dedupeReports(reports: ReportRecord[]): ReportRecord[] {
  const map = new Map<string, ReportRecord>();
  for (const r of reports) map.set(reportKey(r), r);
  return [...map.values()];
}

export function sessionHasUsefulRecords(session: { reportCount: number; reports: ReportRecord[]; allianceCount: number }): boolean {
  return session.reportCount > 0 || session.reports.length > 0 || session.allianceCount > 0;
}

export function sortReportsNewestFirst(reports: ReportRecord[]): ReportRecord[] {
  return [...reports].sort((l, r) => {
    const d = r.id.localeCompare(l.id);
    return d !== 0 ? d : r.sessionId.localeCompare(l.sessionId);
  });
}

export function buildEventText(events: JsonRecord[]): string {
  return events
    .map((e, i) => {
      const seq = asNumber(e["seq"]) ?? i + 1;
      const eventId = asNumber(e["eventId"]) ?? 0;
      const tab = asNumber(e["tab"]) ?? 0;
      const desc = getObjectField(e, "description", "rawText", "raw");
      const prefix = `[${String(seq).padStart(4, "0")} e${eventId} t${tab}]`;
      return desc ? `${prefix} ${desc}` : prefix;
    })
    .join("\n");
}

export function deriveReportDetails(payload: JsonRecord | null, fallbackText: string) {
  const summary = asRecord(payload?.["summary"]) ?? {};
  const heroStatsRecord = asRecord(payload?.["hero_stats"]) ?? asRecord(payload?.["heroStats"]) ?? {};
  const heroStats: Array<[string, JsonRecord]> = Object.entries(heroStatsRecord).map(([name, value]) => [name, asRecord(value) ?? {}]);
  const events = asArray(payload?.["events"]).map(asRecord).filter((i): i is JsonRecord => i !== null);
  const deploy = asRecord(payload?.["deploy"]) ?? {};
  const lineup = asRecord(payload?.["lineup"]) ?? {};
  const buffs = asRecord(payload?.["buffs"]) ?? {};
  const battleDetails = asRecord(payload?.["battleDetails"]);
  let textContent = fallbackText.trim();
  if (!textContent && events.length) textContent = buildEventText(events);
  return { summary, battleDetails, heroStats, events, deploy, lineup, buffs, textContent };
}

export function buildReportFallbackPayload(report: ReportRecord): JsonRecord | null {
  const p: JsonRecord = {};
  const s = asRecord(report.summary);
  const bd = asRecord(report.battleDetails);
  if (s) p.summary = s;
  if (bd) p.battleDetails = bd;
  return Object.keys(p).length > 0 ? p : null;
}

export function parseSummaryPairs(value: unknown): SummaryPair[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const label = asString(item[0]);
      const count = asNumber(item[1]);
      return label && count !== null ? { label, count } : null;
    })
    .filter((i): i is SummaryPair => i !== null);
}

export function parseTopUnits(value: unknown): TopUnitSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const r = asRecord(item);
      if (!r) return null;
      const unit = asString(r["unit"]);
      return unit ? { unit, taken: asNumber(r["taken"]) ?? 0, healed: asNumber(r["healed"]) ?? 0 } : null;
    })
    .filter((i): i is TopUnitSummary => i !== null);
}

// ── Snapshot management ──

export const EMPTY_SNAPSHOT_CONST: AppSnapshot = {
  version: 0,
  scanWorkspace: "", workspaceOutputDir: "",
  connection: { status: "disconnected", mode: "", sessionId: "", outputDir: "", remoteCaptureDir: "", installed: false, process: null },
  logs: [], packets: [], reports: [], sessions: [], alliancePackets: [], allianceRecords: [],
  allianceRecordCount: 0,
};

/**
 * 规范化 get_app_snapshot 返回的 snapshot。
 * `previous` 用于保留**本地按需拉取**的 allianceRecords——P2-2 Phase 1 起该字段
 * 不再随快照下发，若这里不保留就会被每次刷新清空。
 */
export function normaliseSnapshot(payload: unknown, previous?: AppSnapshot): AppSnapshot {
  const r = asRecord(payload);
  if (!r) return previous ?? EMPTY_SNAPSHOT_CONST;
  return {
    version: asNumber(r.version) ?? 0,
    scanWorkspace: asString(r.scanWorkspace),
    workspaceOutputDir: asString(r.workspaceOutputDir),
    connection: (r.connection as AppSnapshot["connection"]) ?? EMPTY_SNAPSHOT_CONST.connection,
    logs: Array.isArray(r.logs) ? (r.logs as LogEntry[]) : [],
    packets: Array.isArray(r.packets) ? (r.packets as PacketRecord[]) : [],
    reports: Array.isArray(r.reports) ? (r.reports as ReportRecord[]) : [],
    sessions: Array.isArray(r.sessions) ? (r.sessions as AppSnapshot["sessions"]) : [],
    alliancePackets: Array.isArray(r.alliancePackets) ? (r.alliancePackets as JsonRecord[]) : [],
    // 快照不再携带记录：优先用 payload（老版本后端仍可能带），否则沿用本地已拉取的数据
    allianceRecords: Array.isArray(r.allianceRecords)
      ? (r.allianceRecords as JsonRecord[])
      : (previous?.allianceRecords ?? []),
    allianceRecordCount: asNumber(r.allianceRecordCount) ?? previous?.allianceRecordCount ?? 0,
  };
}

export function applyLiveCaptureSnapshot(snapshot: AppSnapshot, payload: LiveCaptureSnapshot): AppSnapshot {
  return {
    ...snapshot,
    scanWorkspace: payload.scanWorkspace,
    workspaceOutputDir: payload.workspaceOutputDir,
    connection: payload.connection,
    logs: payload.logs,
    packets: payload.packets,
    reports: payload.reports,
    // P2-2 Phase 1：轮询快照不再携带全量记录，保留本地已拉取的数据，
    // 只更新条数供拉取 effect 判断是否需要重新取。
    allianceRecordCount: payload.allianceRecordCount ?? snapshot.allianceRecordCount,
  };
}

export function applyBridgeEvents(snapshot: AppSnapshot, events: BridgeEventPayload[]): AppSnapshot {
  let next = snapshot;
  let pendingLogs: LogEntry[] = [];
  let pendingPackets: PacketRecord[] = [];

  const flush = () => {
    if (pendingLogs.length === 0 && pendingPackets.length === 0) return;
    next = { ...next, logs: appendLimitedMany(next.logs, pendingLogs, 500), packets: appendLimitedMany(next.packets, pendingPackets, 300) };
    pendingLogs = [];
    pendingPackets = [];
  };

  for (const event of events) {
    if (event.type === "log") {
      pendingLogs.push({ level: asString(event.level) || "info", message: asString(event.message), timestamp: asString(event.timestamp) || new Date().toISOString() });
      continue;
    }
    if (event.type === "packet") {
      if (!isPacketRecord(event)) continue;
      pendingPackets.push(event);
      continue;
    }
    if (event.type === "alliance_packet") continue;
    flush();
    switch (event.type) {
      case "connected":
        next = { ...next, connection: { ...next.connection, status: "connected", mode: asString(event.mode), sessionId: asString(event.sessionId), outputDir: asString(event.outputDir), process: { pid: asNumber(event.pid) ?? 0, name: asString(event.name) } }, packets: [], reports: [], alliancePackets: [] };
        break;
      case "installed":
        next = { ...next, connection: { ...next.connection, installed: true, remoteCaptureDir: asString(event.remoteCaptureDir) } };
        break;
      case "ready":
        next = { ...next, connection: { ...next.connection, status: "ready", remoteCaptureDir: asString(event.remoteCaptureDir) } };
        break;
      case "report":
        if (!isReportRecord(event)) break;
        next = { ...next, reports: appendLimited(next.reports, event, 50) };
        break;
      case "alliance_records": {
        // 桥在采集时会一次性推送全量记录（1 次/采集，非轮询）；同步更新条数
        const records = asArray(event.records).map(asRecord).filter((i): i is JsonRecord => i !== null);
        next = { ...next, allianceRecords: records, allianceRecordCount: records.length };
        break;
      }
      case "disconnected":
        next = { ...next, connection: { ...EMPTY_SNAPSHOT_CONST.connection } };
        break;
    }
  }
  flush();
  return next;
}
