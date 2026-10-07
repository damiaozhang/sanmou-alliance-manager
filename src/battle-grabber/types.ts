export type TabId = "capture" | "alliance" | "history" | "battle" | "stats";
export type CaptureMode = "passive" | "legacy";
export type JsonRecord = Record<string, unknown>;

// ── Rust battle_grabber DTO 镜像（S1-5）──
// 由 ts-rs 生成（@/lib/bindings，cargo test 重新导出），此处仅 re-export；
// Rust 侧 battle_grabber::WorkspaceRecord 已改名 ScanWorkspaceRecord（与 models 工作区类型区分）。
export type {
  ProcessInfo,
  LogEntry,
  PacketRecord,
  ReportRecord,
  SessionRecord,
  ScanWorkspaceRecord,
  ConnectionSnapshot,
  LiveCaptureSnapshot,
} from "@/lib/bindings";

import type { AppSnapshot as AppSnapshotBinding } from "@/lib/bindings";

/**
 * 前端状态里的 snapshot = Rust DTO + **本地按需拉取**的同盟战报记录。
 *
 * P2-2 Phase 1（2026-09-20）：`allianceRecords` 不再随快照下发。单个 workspace 全量
 * 记录可达 60+ MB（实测 0730 = 63 MB / 5703 条），而快照在采集期间会被高频刷新，
 * 整包重复推送与 2026-08-08 那次 WebView2 OOM 属同类风险。现在快照只带
 * `allianceRecordCount`，前端在记录数变化/切换工作区时调用 `get_alliance_records`
 * 拉取一次并存入本字段（见 useBattleSnapshot 的拉取 effect）。
 */
export type AppSnapshot = AppSnapshotBinding & {
  allianceRecords: JsonRecord[];
};

export interface AuthoritativeTerms {
  heroes: Record<string, string>;
  formations?: Record<string, string>;
  skills: Record<string, string>;
  warbooks: Record<string, string>;
  equipment: Record<string, string>;
  horses: Record<string, string>;
  equipmentEffects: Record<string, string>;
  horseEffects: Record<string, string>;
  equipmentSkills: Record<string, string>;
  horseSkills: Record<string, string>;
}

export interface BridgeEventPayload extends JsonRecord {
  type?: string;
}

export interface SummaryPair {
  label: string;
  count: number;
}

export interface TopUnitSummary {
  unit: string;
  taken: number;
  healed: number;
}

export type AllianceSidePrefix = "attack" | "defend";
export type AllianceOutcome = "win" | "loss" | "draw" | "unknown";

export interface AllianceTroopTotals {
  originTroops: number;
  remainingTroops: number;
  wounded: number;
  dead: number;
}

export interface AllianceLineupStat {
  key: string;
  label: string;
  formationId?: string;
  formationName?: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  unknowns: number;
  attackBattles: number;
  defendBattles: number;
  totalMerit?: number;
  meritBattles?: number;
  totalOriginTroops: number;
  totalRemainingTroops: number;
  totalWounded: number;
  totalDead: number;
  totalEnemyOriginTroops: number;
  totalEnemyRemainingTroops: number;
  totalEnemyWounded: number;
  totalEnemyDead: number;
  totalEvolution: number;
  evolutionCount: number;
  totalHeroLevel?: number;
  heroLevelCount?: number;
  lastBattleTime: string;
}

export interface AllianceLineupIdentity {
  key: string;
  label: string;
  ids: string[];
  formationId: string;
  formationName: string;
  heroLevels: number[];
  player: string;
  avatarId: string;
  armyId: string;
  parentBattleId: string;
}

export interface AllianceBattleAggregation {
  recordKey: string;
  record: JsonRecord;
  prefix: AllianceSidePrefix;
  outcome: AllianceOutcome;
  battleTime: string;
  merit: number;
  countAsBattle: boolean;
  countMerit: boolean;
}

export interface AllianceStreakStat {
  key: string;
  label: string;
  player: string;
  alliance: string;
  side: AllianceSidePrefix | "";
  battleCount: number;
  winBattleNum: number;
  chainMerit: number;
  totalMerit: number;
  killNum: number;
  finalBattleMerit: number;
  battleTime: string;
  location: string;
  parentBattleId: string;
}

export interface AllianceContinuousSummary {
  side: AllianceSidePrefix;
  avatarId: string;
  armyId: string;
  battleCount: number;
  winBattleNum: number;
  chainMerit: number;
  totalMerit: number;
  finalBattleMerit: number;
  killNum: number;
}

export interface AllianceMatchupStat {
  key: string;
  leftKey: string;
  leftLabel: string;
  rightKey: string;
  rightLabel: string;
  battles: number;
  leftWins: number;
  rightWins: number;
  draws: number;
  unknowns: number;
  lastBattleTime: string;
}

export interface AllianceMatchupView {
  key: string;
  primaryLabel: string;
  opponentLabel: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  unknowns: number;
  winRate: number;
  lastBattleTime: string;
}

export interface BattleAttr {
  key: string;
  label: string;
  value: string;
  name: string;
}

export interface BattleSkill {
  skillId: string;
  name: string;
  level: number | null;
  orderLevel: number | null;
  position: number | null;
  showReplace: boolean;
}

export interface BattleWarbook {
  warbookId: string;
  name: string;
}

export interface BattleHeroDetail {
  heroId: string;
  name: string;
  displayName: string;
  position: number | null;
  group: number | null;
  basicArmsId: number | null;
  basicArmsName: string;
  level: number | null;
  evolution: number | null;
  enlighten: number | null;
  originTroops: number | null;
  armyTroops: number | null;
  remainingTroops: number | null;
  dead: number | null;
  wounded: number | null;
  skills: BattleSkill[];
  warbooks: BattleWarbook[];
  warbookItemId: string;
  equipment: {
    equipId: string;
    name: string;
    attrs: BattleAttr[];
  };
  horse: {
    horseId: string;
    name: string;
    attrs: BattleAttr[];
  };
}

export interface BattleTeamDetail {
  side: string;
  label: string;
  armyId: string;
  winner: boolean;
  leaderHeroId: string;
  player: {
    avatarId: string;
    name: string;
    allianceId: string;
    allianceName: string;
    faction: number | null;
    bornStateId: number | null;
  };
  formationId: string;
  formationName: string;
  morale: number | null;
  originZgNum: number | null;
  zgNum: number | null;
  totalTroopNum: number | null;
  nowTroopNum: number | null;
  heroes: BattleHeroDetail[];
  totals: {
    originTroops: number;
    remainingTroops: number;
    dead: number;
    wounded: number;
  };
}

export interface BattleDetails {
  schema: string;
  source: string;
  battleId: string;
  matchType: number | null;
  combatType: number | null;
  scenarioId: number | null;
  endRound: number | null;
  winnerArmyId: string;
  location: unknown[];
  attacker: BattleTeamDetail | null;
  defender: BattleTeamDetail | null;
}

export type BrowserWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_IPC__?: unknown;
};

export type SortDirection = "asc" | "desc";
export type AllianceLineupSortKey =
  | "battles"
  | "winRate"
  | "merit"
  | "averageEvolution"
  | "averageHeroLevel"
  | "averageCasualties"
  | "lossRate"
  | "enemyLossRate"
  | "lossExchangeRatio"
  | "lastBattleTime";

export interface AllianceLineupSort {
  key: AllianceLineupSortKey;
  direction: SortDirection;
}
