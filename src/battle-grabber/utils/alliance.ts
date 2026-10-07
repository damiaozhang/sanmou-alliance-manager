import type {
  JsonRecord,
  AllianceSidePrefix,
  AllianceOutcome,
  AllianceTroopTotals,
  AllianceLineupStat,
  AllianceLineupIdentity,
  AllianceBattleAggregation,
  AllianceMatchupStat,
  AllianceMatchupView,
  AllianceStreakStat,
  AllianceLineupSort,
  AllianceLineupSortKey,
} from "../types";
import {
  ALLIANCE_SIDE_PREFIXES, ALLIANCE_HERO_NAMES, MIN_ALLIANCE_LINEUP_BATTLES, AUTHORITATIVE_FORMATION_NAMES,
  MIN_ALLIANCE_HERO_LEVEL, MIN_ALLIANCE_ARMY_TROOPS, FAKE_ARMY_TROOPS_MAX,
} from "../constants";
import {
  asRecord, asArray, asString, asNumber, asId, getObjectField, getNumericField, csvCell,
} from "./helpers";
import { formatAllianceFormationLabel, normaliseFormationName } from "./format";

// ── Hero name resolution ──

function isProtocolHeroFallbackName(value: string): boolean {
  const text = value.trim();
  return /^#?\d+$/.test(text) || /^武将\s*#?\d+$/.test(text);
}

function isUsableHeroName(value: string): boolean {
  return Boolean(value.trim()) && !isProtocolHeroFallbackName(value);
}

function allianceHeroFallbackName(heroId: string): string {
  return heroId ? `未识别武将 ${heroId}` : "未知武将";
}

function allianceHeroNameFromRecord(hero: JsonRecord): string {
  const heroId = asId(hero["heroId"]);
  const mappedName = heroId ? ALLIANCE_HERO_NAMES[heroId] : "";
  const displayName = asString(hero["displayName"]);
  const name = asString(hero["name"]);
  if (mappedName) return mappedName;
  if (isUsableHeroName(displayName)) return displayName;
  if (isUsableHeroName(name)) return name;
  return allianceHeroFallbackName(heroId);
}

export function allianceHeroLabelFromRecord(hero: JsonRecord, includeRed: boolean): string {
  const name = allianceHeroNameFromRecord(hero);
  if (!includeRed) return name;
  const evolution = asNumber(hero["evolution"]);
  const red = evolution !== null ? `（${evolution}红）` : "";
  return `${name}${red}`;
}

// ── Side record accessors ──

export function getAllianceSideRecord(record: JsonRecord, prefix: AllianceSidePrefix): JsonRecord | null {
  return asRecord(record[prefix === "attack" ? "attacker" : "defender"]);
}

export function getAllianceSidePlayer(record: JsonRecord, prefix: AllianceSidePrefix): JsonRecord {
  const side = getAllianceSideRecord(record, prefix);
  return side ? asRecord(side["player"]) ?? {} : {};
}

// ── Aggregated side summary ──

/**
 * 聚合某一侧（攻方/守方）的全部可读字段，避免调用方反复调用十几个细粒度 accessor。
 * 原有的 11+ 个 getAllianceSide* 函数均已改为调用本函数取对应字段，保持向后兼容。
 */
export interface AllianceSideSummary {
  /** 同盟名称（顶层 attackAlliance/defendAlliance 或 player.allianceName） */
  allianceName: string;
  /** 玩家名称（顶层 attackPlayer/defendPlayer 或 player.name） */
  playerName: string;
  /** 阵型名称（side.formationName 经 normaliseFormationName 处理，或权威阵型名映射） */
  formationName: string;
  /** 阵容可读标签（武将名 / 阵容ID 映射 / 原始阵容文本，取首个有效来源） */
  lineupLabel: string;
  /** 武将等级列表（heroes 中每个 level，过滤 null） */
  heroLevels: number[];
  /** 武勋值（顶层 attackMerit/defendMerit 优先，否则 side.merit / side.zgNum） */
  merit: number;
  /** 兵力统计（originTroops / remainingTroops / wounded / dead） */
  troopTotals: AllianceTroopTotals;
  /** 战斗结果（win / loss / draw / unknown） */
  outcome: AllianceOutcome;
  /** 头像 ID（player.avatarId） */
  avatarId: string;
  /** 武将列表（side.heroes 数组，过滤 null 记录） */
  heroes: JsonRecord[];
  /** 进阶红数统计（total 红数总和 + count 有效数量） */
  evolutionSummary: { total: number; count: number };
  /** 阵容 ID 列表（heroes.heroId 优先，否则 side.lineupIds，否则拆分纯ID文本） */
  lineupIds: string[];
  /** 阵型 ID（side.formationId 或顶层 attackFormationId/defendFormationId） */
  formationId: string;
}

export function getAllianceSideSummary(record: JsonRecord, prefix: AllianceSidePrefix): AllianceSideSummary {
  const side = getAllianceSideRecord(record, prefix);
  const player = getAllianceSidePlayer(record, prefix);

  // ─ 同盟 / 玩家 / 头像 ─
  const allianceName = getObjectField(record, `${prefix}Alliance`, `${prefix}_alliance`) || asString(player["allianceName"]);
  const playerName = getObjectField(record, `${prefix}Player`, `${prefix}_player`) || asString(player["name"]);
  const avatarId = asId(player["avatarId"]);

  // ─ 阵型 ID / 名称 ─
  const formationId = side ? asId(side["formationId"]) : getObjectField(record, `${prefix}FormationId`);
  const formationName = normaliseFormationName(
    (side ? asString(side["formationName"]) : "") || AUTHORITATIVE_FORMATION_NAMES[formationId] || ""
  );

  // ─ 武将列表 / 等级 / 进阶统计 ─
  const heroes = side
    ? asArray(side["heroes"]).map(asRecord).filter((h): h is JsonRecord => h !== null)
    : [];
  const heroLevels = heroes
    .map((h) => asNumber(h["level"]))
    .filter((l): l is number => l !== null);
  const evolutionSummary = heroes.reduce<{ total: number; count: number }>(
    (acc, hero) => {
      const evo = asNumber(hero["evolution"]);
      return evo === null ? acc : { total: acc.total + evo, count: acc.count + 1 };
    },
    { total: 0, count: 0 }
  );

  // ─ 兵力统计 / 武勋 ─
  const totals = side ? asRecord(side["totals"]) : null;
  const troopTotals: AllianceTroopTotals = {
    originTroops: asNumber(totals?.["originTroops"]) ?? 0,
    remainingTroops: asNumber(totals?.["remainingTroops"]) ?? 0,
    wounded: asNumber(totals?.["wounded"]) ?? 0,
    dead: asNumber(totals?.["dead"]) ?? 0,
  };
  const flatMerit = asNumber(record[prefix === "attack" ? "attackMerit" : "defendMerit"]);
  const merit = flatMerit !== null
    ? flatMerit
    : (side ? (asNumber(side["merit"]) ?? asNumber(side["zgNum"]) ?? 0) : 0);

  // ─ 阵容 ID 列表 ─
  const heroIds = heroes
    .map((h) => asId(h["heroId"])).map(normaliseLineupToken).filter(Boolean);
  let lineupIds: string[];
  if (heroIds.length > 0) {
    lineupIds = heroIds;
  } else {
    const sideIds = side ? asArray(side["lineupIds"]).map(asId).map(normaliseLineupToken).filter(Boolean) : [];
    if (sideIds.length > 0) {
      lineupIds = sideIds;
    } else {
      const rawLineup = getObjectField(record, `${prefix}LineupWithReds`, `${prefix}Lineup`, `${prefix}_lineup`);
      lineupIds = rawLineup && isIdOnlyLineup(rawLineup) ? splitLineupTokens(rawLineup) : [];
    }
  }

  // ─ 阵容标签（内联 getAllianceMappedLineup 逻辑以避免与包装器循环依赖） ─
  let mapped = "";
  if (side) {
    const heroNames = heroes
      .map((h) => allianceHeroLabelFromRecord(h, false))
      .filter(Boolean);
    if (heroNames.length > 0) {
      mapped = heroNames.join(" / ");
    } else {
      const mappedLineupIds = asArray(side["lineupIds"]).map(asId)
        .map((id) => ALLIANCE_HERO_NAMES[id] || allianceHeroFallbackName(id)).filter(Boolean);
      if (mappedLineupIds.length > 0) {
        mapped = mappedLineupIds.join(" / ");
      } else {
        mapped = asArray(side["lineupNames"]).map(asId).filter(isUsableHeroName).join(" / ");
      }
    }
  }
  let lineupLabel: string;
  if (mapped) {
    lineupLabel = normaliseLineupLabel(mapped);
  } else {
    const rawLabel = getObjectField(record, `${prefix}LineupWithReds`, `${prefix}Lineup`, `${prefix}_lineup`);
    if (rawLabel && !isIdOnlyLineup(rawLabel)) {
      lineupLabel = normaliseLineupLabel(rawLabel);
    } else {
      const sideLineup = side ? asString(side["lineup"]) : "";
      if (sideLineup && !isIdOnlyLineup(sideLineup)) {
        lineupLabel = normaliseLineupLabel(sideLineup);
      } else {
        lineupLabel = normaliseLineupLabel(mapped || sideLineup);
      }
    }
  }

  // ─ 战斗结果 ─
  const ws = getObjectField(record, "winnerSide");
  let outcome: AllianceOutcome;
  if (ws === "draw") {
    outcome = "draw";
  } else if (ws === "attacker_win" || ws === "attack_win") {
    outcome = prefix === "attack" ? "win" : "loss";
  } else if (ws === "defender_win" || ws === "defend_win") {
    outcome = prefix === "defend" ? "win" : "loss";
  } else {
    const result = getObjectField(record, "result", "battleResult");
    if (result.includes("平")) {
      outcome = "draw";
    } else if (result.includes("攻方胜")) {
      outcome = prefix === "attack" ? "win" : "loss";
    } else if (result.includes("守方胜")) {
      outcome = prefix === "defend" ? "win" : "loss";
    } else {
      const winner = side?.["winner"];
      if (typeof winner === "boolean") {
        if (winner) {
          outcome = "win";
        } else {
          const wid = getObjectField(record, "winnerArmyId");
          outcome = wid && wid !== "0" ? "loss" : "unknown";
        }
      } else {
        outcome = "unknown";
      }
    }
  }

  return {
    allianceName,
    playerName,
    formationName,
    lineupLabel,
    heroLevels,
    merit,
    troopTotals,
    outcome,
    avatarId,
    heroes,
    evolutionSummary,
    lineupIds,
    formationId,
  };
}

// ── Side field accessors (backward-compatible wrappers around getAllianceSideSummary) ──

export function getAllianceSideAllianceName(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).allianceName;
}

export function getAllianceSidePlayerName(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).playerName;
}

export function getAllianceSideAvatarId(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).avatarId;
}

export function getAllianceSideArmyId(record: JsonRecord, prefix: AllianceSidePrefix): string {
  const side = getAllianceSideRecord(record, prefix);
  return side ? asId(side["armyId"]) : "";
}

export function getAllianceSideFormationId(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).formationId;
}

export function getAllianceSideFormationName(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).formationName;
}

export function getAllianceSideHeroes(record: JsonRecord, prefix: AllianceSidePrefix): JsonRecord[] {
  return getAllianceSideSummary(record, prefix).heroes;
}

export function getAllianceSideHeroLevels(record: JsonRecord, prefix: AllianceSidePrefix): number[] {
  return getAllianceSideSummary(record, prefix).heroLevels;
}

export function getAllianceSideTroopTotals(record: JsonRecord, prefix: AllianceSidePrefix): AllianceTroopTotals {
  return getAllianceSideSummary(record, prefix).troopTotals;
}

export function getAllianceSideMerit(record: JsonRecord, prefix: AllianceSidePrefix): number {
  return getAllianceSideSummary(record, prefix).merit;
}

export function getAllianceSideEvolutionSummary(record: JsonRecord, prefix: AllianceSidePrefix): { total: number; count: number } {
  return getAllianceSideSummary(record, prefix).evolutionSummary;
}

export function getAllianceSideTroopText(record: JsonRecord, prefix: AllianceSidePrefix): string {
  const flat = getObjectField(record, `${prefix}Troops`, `${prefix}_troops`);
  if (flat) return flat;
  const t = getAllianceSideTroopTotals(record, prefix);
  const has = t.originTroops > 0 || t.remainingTroops > 0 || t.wounded > 0 || t.dead > 0;
  return has ? `${t.remainingTroops.toLocaleString('zh-CN')}/${t.originTroops.toLocaleString('zh-CN')} 伤${t.wounded.toLocaleString('zh-CN')} 阵亡${t.dead.toLocaleString('zh-CN')}` : "";
}

// ── Lineup logic ──

function normaliseLineupToken(value: string): string {
  return value.trim().replace(/^#/, "");
}

function normaliseLineupLabel(value: string): string {
  return value.split("/").map((p) => p.trim()).filter(Boolean).join(" / ");
}

function splitLineupTokens(value: string): string[] {
  return value.split("/").map(normaliseLineupToken).filter(Boolean);
}

function canonicalLineupTokens(tokens: string[]): string[] {
  return [...tokens].map(normaliseLineupToken).filter(Boolean).sort((l, r) => {
    const ln = Number(l), rn = Number(r);
    if (Number.isFinite(ln) && Number.isFinite(rn)) return ln - rn;
    return l.localeCompare(r, "zh-Hans-CN");
  });
}

function uniqueLineupTokens(tokens: string[]): string[] {
  return [...new Set(canonicalLineupTokens(tokens))];
}

function lineupTokensContainAll(full: string[], partial: string[]): boolean {
  const set = new Set(full);
  return partial.every((t) => set.has(t));
}

function isIdOnlyLineup(value: string): boolean {
  const parts = value.split("/").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^\d+$/.test(p) || /^#\d+$/.test(p));
}

function getAllianceMappedLineup(record: JsonRecord, prefix: AllianceSidePrefix, includeRed = false): string {
  const side = getAllianceSideRecord(record, prefix);
  if (!side) return "";
  const heroNames = getAllianceSideHeroes(record, prefix)
    .map((h) => allianceHeroLabelFromRecord(h, includeRed))
    .filter(Boolean);
  if (heroNames.length > 0) return heroNames.join(" / ");
  const lineupIds = asArray(side["lineupIds"]).map(asId)
    .map((id) => ALLIANCE_HERO_NAMES[id] || allianceHeroFallbackName(id)).filter(Boolean);
  if (lineupIds.length > 0) return lineupIds.join(" / ");
  return asArray(side["lineupNames"]).map(asId).filter(isUsableHeroName).join(" / ");
}

export function getAllianceSideLineupIds(record: JsonRecord, prefix: AllianceSidePrefix): string[] {
  return getAllianceSideSummary(record, prefix).lineupIds;
}

export function getAllianceSideLineupLabel(record: JsonRecord, prefix: AllianceSidePrefix): string {
  return getAllianceSideSummary(record, prefix).lineupLabel;
}

export function getAllianceSideLineupDisplayLabel(record: JsonRecord, prefix: AllianceSidePrefix): string {
  const mapped = getAllianceMappedLineup(record, prefix, true);
  if (mapped) return normaliseLineupLabel(mapped);
  return getAllianceSideLineupLabel(record, prefix);
}

function getAllianceSideLineupKey(record: JsonRecord, prefix: AllianceSidePrefix): string {
  const ids = getAllianceSideLineupIds(record, prefix);
  const fId = getAllianceSideFormationId(record, prefix);
  const fPart = fId || "unknown";
  if (ids.length > 0) return `formation:${fPart}|ids:${canonicalLineupTokens(ids).join("/")}`;
  const label = getAllianceSideLineupLabel(record, prefix);
  return label ? `formation:${fPart}|label:${canonicalLineupTokens(splitLineupTokens(label)).join("/")}` : "";
}

export function getAllianceLineupIdentity(record: JsonRecord, prefix: AllianceSidePrefix): AllianceLineupIdentity | null {
  const ids = uniqueLineupTokens(getAllianceSideLineupIds(record, prefix));
  const key = getAllianceSideLineupKey(record, prefix);
  if (!key) return null;
  const fId = getAllianceSideFormationId(record, prefix);
  const fName = getAllianceSideFormationName(record, prefix);
  return {
    key,
    label: [formatAllianceFormationLabel(fId, fName), getAllianceSideLineupLabel(record, prefix)]
      .filter(Boolean).join(" · ") || "未知阵容",
    ids,
    formationId: fId,
    formationName: fName,
    heroLevels: getAllianceSideHeroLevels(record, prefix),
    player: getAllianceSidePlayerName(record, prefix),
    avatarId: getAllianceSideAvatarId(record, prefix),
    armyId: getAllianceSideArmyId(record, prefix),
    parentBattleId: getAllianceParentBattleId(record),
  };
}

// ── Outcome / time / win rate ──

export function getAllianceSideOutcome(record: JsonRecord, prefix: AllianceSidePrefix): AllianceOutcome {
  return getAllianceSideSummary(record, prefix).outcome;
}

export function getAllianceWinnerLabel(record: JsonRecord): string {
  const ws = getObjectField(record, "winnerSide");
  if (ws === "attacker_win" || ws === "attack_win") return "攻方";
  if (ws === "defender_win" || ws === "defend_win") return "守方";
  if (ws === "draw") return "平局";
  const result = getObjectField(record, "result", "battleResult");
  if (result.includes("攻方胜")) return "攻方";
  if (result.includes("守方胜")) return "守方";
  return result || "-";
}

export function getAllianceBattleTime(record: JsonRecord): string {
  return getObjectField(record, "battleTime", "battle_time", "createTime");
}

export function parseTimeForSort(value: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newerAllianceTime(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const lt = parseTimeForSort(left), rt = parseTimeForSort(right);
  if (lt || rt) return rt > lt ? right : left;
  return right.localeCompare(left) > 0 ? right : left;
}

export function allianceWinRate(wins: number, losses: number, draws = 0): number {
  const known = wins + losses + draws;
  return known <= 0 ? 0 : (wins + draws * 0.5) / known;
}

export function getAllianceLossRate(totalDead: number, totalWounded: number, totalOriginTroops: number): number {
  return totalOriginTroops > 0 ? (totalDead + totalWounded) / totalOriginTroops : 0;
}

export function getAllianceEnemyLossRate(totalEnemyDead: number, totalEnemyWounded: number, totalEnemyOriginTroops: number): number {
  return totalEnemyOriginTroops > 0 ? (totalEnemyDead + totalEnemyWounded) / totalEnemyOriginTroops : 0;
}

// ── Record key / type ──

/**
 * 从内容字段生成稳定 fallback key（不依赖数组下标）。
 * 中间记录被删除或排序变化时同一场战斗仍得到相同 key，
 * lineup_matchup 的 UNIQUE 约束才能正确去重。
 */
function stableRecordKey(record: JsonRecord): string {
  const parts = [
    getObjectField(record, "parentBattleId"),
    getObjectField(record, "battleId", "combatId", "reportId"),
    getObjectField(record, "battleTime", "battle_time", "createTime"),
    getObjectField(record, "territory", "location", "coord"),
  ];
  const attacker = asRecord(record["attacker"]);
  const defender = asRecord(record["defender"]);
  const aPlayer = attacker ? getObjectField(attacker, "playerName", "name", "avatarName") : "";
  const dPlayer = defender ? getObjectField(defender, "playerName", "name", "avatarName") : "";
  const aArmy = attacker ? getObjectField(attacker, "armyId", "army_id", "armyIndex") : "";
  const dArmy = defender ? getObjectField(defender, "armyId", "army_id", "armyIndex") : "";
  parts.push(aPlayer, dPlayer, aArmy, dArmy);
  return parts.filter((p) => p !== "").join(":");
}

export function getAllianceRecordKey(record: JsonRecord, index: number): string {
  return (
    getObjectField(record, "recordKey") ||
    getObjectField(record, "battleCode", "combatCode", "blockHash") ||
    stableRecordKey(record) ||
    `record:${index}`
  );
}

export function getAllianceRecordType(record: JsonRecord): string {
  return getObjectField(record, "recordType");
}

export function isAllianceBlockRecord(record: JsonRecord): boolean {
  return getAllianceRecordType(record) === "block";
}

export function isAllianceChildRecord(record: JsonRecord): boolean {
  return getAllianceRecordType(record) === "child";
}

export function getAllianceParentBattleId(record: JsonRecord): string {
  return getObjectField(record, "parentBattleId") || getObjectField(record, "battleId");
}

// ── Continuous / streak ──

export function getAllianceContinuousBattleCount(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["battleCount"]) ?? asNumber(record["continuousBattleCount"]) ?? 0;
}

export function getAllianceContinuousWinBattleNum(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["winBattleNum"]) ?? asNumber(record["continuousWinBattleNum"]) ?? 0;
}

export function getAllianceContinuousChainMerit(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["chainMerit"]) ?? asNumber(record["continuousChainMerit"]) ?? 0;
}

export function getAllianceContinuousTotalMerit(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["totalMerit"]) ?? asNumber(record["continuousTotalMerit"]) ?? 0;
}

export function getAllianceContinuousFinalBattleMerit(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["finalBattleMerit"]) ?? asNumber(record["continuousFinalBattleMerit"]) ?? 0;
}

export function getAllianceContinuousKillNum(record: JsonRecord): number {
  const c = asRecord(record["continuous"]);
  return asNumber(c?.["killNum"]) ?? asNumber(record["continuousKillNum"]) ?? 0;
}

// ── Full lineup resolver ──

function identityScopeKey(identity: AllianceLineupIdentity): string {
  return [identity.parentBattleId, identity.player].filter(Boolean).join("::");
}

function addFullIdentity(map: Map<string, AllianceLineupIdentity[]>, scope: string, identity: AllianceLineupIdentity): void {
  if (!scope) return;
  const bucket = map.get(scope) ?? [];
  if (!bucket.some((i) => i.key === identity.key)) {
    bucket.push(identity);
    map.set(scope, bucket);
  }
}

export function buildAllianceFullLineupResolver(records: JsonRecord[]): (identity: AllianceLineupIdentity) => AllianceLineupIdentity {
  const fullByScope = new Map<string, AllianceLineupIdentity[]>();
  const fullGlobal: AllianceLineupIdentity[] = [];

  for (const record of records) {
    for (const prefix of ALLIANCE_SIDE_PREFIXES) {
      const identity = getAllianceLineupIdentity(record, prefix);
      if (!identity || identity.ids.length < 3 || !isValidAllianceLineup(record, prefix)) continue;
      addFullIdentity(fullByScope, identityScopeKey(identity), identity);
      addFullIdentity(fullByScope, identity.parentBattleId, identity);
      if (!fullGlobal.some((i) => i.key === identity.key)) fullGlobal.push(identity);
    }
  }

  function findUnique(identity: AllianceLineupIdentity, candidates: AllianceLineupIdentity[]): AllianceLineupIdentity | null {
    if (identity.ids.length === 0 || identity.ids.length >= 3) return null;
    const partial = uniqueLineupTokens(identity.ids);
    const matches = candidates.filter((c) => {
      if (identity.formationId && c.formationId !== identity.formationId) return false;
      return lineupTokensContainAll(c.ids, partial);
    });
    const unique = new Map(matches.map((m) => [m.key, m]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  }

  return (identity: AllianceLineupIdentity): AllianceLineupIdentity => {
    const scoped =
      findUnique(identity, fullByScope.get(identityScopeKey(identity)) ?? []) ??
      findUnique(identity, fullByScope.get(identity.parentBattleId) ?? []) ??
      findUnique(identity, fullGlobal);
    return scoped ?? identity;
  };
}

/**
 * 侧兵力（终审口径）：优先 totals.armyTroops，旧数据兼容回退 totals.originTroops。
 * 返回 0 表示兵力缺失。
 */
export function getAllianceSideArmyTroops(record: JsonRecord, prefix: AllianceSidePrefix): number {
  const side = getAllianceSideRecord(record, prefix);
  const totals = side ? asRecord(side["totals"]) : null;
  return asNumber(totals?.["armyTroops"]) ?? asNumber(totals?.["originTroops"]) ?? 0;
}

/**
 * 阵容质量校验（终审口径，阈值集中在 constants.ts）：
 * - 满编 3 将（child 残队 < 3 将直接过滤）；
 * - 所有武将 level >= MIN_ALLIANCE_HERO_LEVEL（46）；
 * - 兵力 >= MIN_ALLIANCE_ARMY_TROOPS（5000）；兵力 <= FAKE_ARMY_TROOPS_MAX（100）
 *   的是「武将数」而非兵力（假兵力），同样过滤。
 */
export function isValidAllianceLineup(record: JsonRecord, prefix: AllianceSidePrefix): boolean {
  const heroes = getAllianceSideHeroes(record, prefix);
  if (heroes.length < 3) return false;
  const levelsOk = heroes.every((h) => {
    const level = asNumber(h["level"]);
    return level !== null && level >= MIN_ALLIANCE_HERO_LEVEL;
  });
  if (!levelsOk) return false;
  const troops = getAllianceSideArmyTroops(record, prefix);
  if (troops <= FAKE_ARMY_TROOPS_MAX) return false;
  return troops >= MIN_ALLIANCE_ARMY_TROOPS;
}

function sideMatchesAllianceFilter(record: JsonRecord, prefix: AllianceSidePrefix, allianceName: string): boolean {
  return !allianceName || getAllianceSideAllianceName(record, prefix) === allianceName;
}

export function getAllianceFilterOptions(records: JsonRecord[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    for (const prefix of ALLIANCE_SIDE_PREFIXES) {
      const name = getAllianceSideAllianceName(record, prefix);
      if (name) names.add(name);
    }
  }
  return [...names].sort((l, r) => l.localeCompare(r, "zh-Hans-CN"));
}

// ── Aggregation ──

function allianceLineupLabelScore(value: string): number {
  if (!value) return 0;
  return value.split("/").map((p) => p.trim()).reduce((s, p) => s + (isProtocolHeroFallbackName(p) ? 0 : 1), 0);
}

export function buildAllianceBattleAggregations(records: JsonRecord[]): AllianceBattleAggregation[] {
  const agg: AllianceBattleAggregation[] = [];
  records.forEach((record, index) => {
    const rk = getAllianceRecordKey(record, index);
    for (const prefix of ALLIANCE_SIDE_PREFIXES) {
      if (!isValidAllianceLineup(record, prefix)) continue;
      const identity = getAllianceLineupIdentity(record, prefix);
      if (!identity) continue;
      agg.push({
        recordKey: rk, record, prefix,
        outcome: getAllianceSideOutcome(record, prefix),
        battleTime: getAllianceBattleTime(record),
        merit: getAllianceSideMerit(record, prefix),
        countAsBattle: true, countMerit: true,
      });
    }
  });
  return agg;
}

export function buildAllianceLineupStats(records: JsonRecord[], allianceNameFilter: string): AllianceLineupStat[] {
  const statsByKey = new Map<string, AllianceLineupStat>();
  const resolveFull = buildAllianceFullLineupResolver(records);

  for (const item of buildAllianceBattleAggregations(records)) {
    const { record, prefix } = item;
    if (!sideMatchesAllianceFilter(record, prefix, allianceNameFilter)) continue;
    const identity = getAllianceLineupIdentity(record, prefix);
    if (!identity) continue;
    const resolved = resolveFull(identity);
    const key = resolved.key;
    const label = resolved.label || identity.label || "未知阵容";
    const current = statsByKey.get(key) ?? {
      key, label, formationId: resolved.formationId, formationName: resolved.formationName,
      battles: 0, wins: 0, losses: 0, draws: 0, unknowns: 0,
      attackBattles: 0, defendBattles: 0, totalMerit: 0, meritBattles: 0,
      totalOriginTroops: 0, totalRemainingTroops: 0, totalWounded: 0, totalDead: 0,
      totalEnemyOriginTroops: 0, totalEnemyRemainingTroops: 0, totalEnemyWounded: 0, totalEnemyDead: 0,
      totalEvolution: 0, evolutionCount: 0, totalHeroLevel: 0, heroLevelCount: 0, lastBattleTime: "",
    };

    if (allianceLineupLabelScore(label) > allianceLineupLabelScore(current.label)) current.label = label;

    if (item.countAsBattle) {
      current.battles += 1;
      current.attackBattles += prefix === "attack" ? 1 : 0;
      current.defendBattles += prefix === "defend" ? 1 : 0;
      if (item.outcome === "win") current.wins += 1;
      else if (item.outcome === "loss") current.losses += 1;
      else if (item.outcome === "draw") current.draws += 1;
      else current.unknowns += 1;

      const t = getAllianceSideTroopTotals(record, prefix);
      current.totalOriginTroops += t.originTroops;
      current.totalRemainingTroops += t.remainingTroops;
      current.totalWounded += t.wounded;
      current.totalDead += t.dead;
      const ep = prefix === "attack" ? "defend" : "attack";
      const et = getAllianceSideTroopTotals(record, ep);
      current.totalEnemyOriginTroops += et.originTroops;
      current.totalEnemyRemainingTroops += et.remainingTroops;
      current.totalEnemyWounded += et.wounded;
      current.totalEnemyDead += et.dead;
      const es = getAllianceSideEvolutionSummary(record, prefix);
      current.totalEvolution += es.total;
      current.evolutionCount += es.count;
      const rl = getAllianceSideHeroLevels(record, prefix);
      const levels = (resolved.heroLevels.length > rl.length ? resolved.heroLevels : rl);
      current.totalHeroLevel = (current.totalHeroLevel ?? 0) + levels.reduce((s, l) => s + l, 0);
      current.heroLevelCount = (current.heroLevelCount ?? 0) + levels.length;
    }
    if (item.countMerit) {
      current.totalMerit = (current.totalMerit ?? 0) + item.merit;
      if (item.merit > 0) current.meritBattles = (current.meritBattles ?? 0) + 1;
    }
    current.lastBattleTime = newerAllianceTime(current.lastBattleTime, item.battleTime);
    statsByKey.set(key, current);
  }
  return [...statsByKey.values()].filter((s) => s.battles >= MIN_ALLIANCE_LINEUP_BATTLES);
}

// ── Matchup stats ──

export function buildAllianceMatchupStats(records: JsonRecord[], allianceNameFilter: string): AllianceMatchupStat[] {
  const statsByKey = new Map<string, AllianceMatchupStat>();
  const resolveFull = buildAllianceFullLineupResolver(records);
  const aggs = buildAllianceBattleAggregations(records);
  const aggBySide = new Map(aggs.map((a) => [`${a.recordKey}:${a.prefix}`, a]));

  for (const item of aggs) {
    if (item.prefix !== "attack") continue;
    const defAgg = aggBySide.get(`${item.recordKey}:defend`);
    if (!item.countAsBattle || defAgg?.countAsBattle === false) continue;
    const { record } = item;
    if (allianceNameFilter && !sideMatchesAllianceFilter(record, "attack", allianceNameFilter) && !sideMatchesAllianceFilter(record, "defend", allianceNameFilter)) continue;
    const aId = getAllianceLineupIdentity(record, "attack");
    const dId = getAllianceLineupIdentity(record, "defend");
    if (!aId || !dId) continue;
    const rA = resolveFull(aId), rD = resolveFull(dId);
    const aFirst = rA.key.localeCompare(rD.key, "zh-Hans-CN") <= 0;
    const lk = aFirst ? rA.key : rD.key, rk = aFirst ? rD.key : rA.key;
    const ll = aFirst ? rA.label : rD.label, rl = aFirst ? rD.label : rA.label;
    const key = `${lk}__${rk}`;
    const cur = statsByKey.get(key) ?? { key, leftKey: lk, leftLabel: ll, rightKey: rk, rightLabel: rl, battles: 0, leftWins: 0, rightWins: 0, draws: 0, unknowns: 0, lastBattleTime: "" };
    if (allianceLineupLabelScore(ll) > allianceLineupLabelScore(cur.leftLabel)) cur.leftLabel = ll;
    if (allianceLineupLabelScore(rl) > allianceLineupLabelScore(cur.rightLabel)) cur.rightLabel = rl;
    const lOutcome = aFirst ? item.outcome : defAgg?.outcome ?? getAllianceSideOutcome(record, "defend");
    const rOutcome = aFirst ? defAgg?.outcome ?? getAllianceSideOutcome(record, "defend") : item.outcome;
    cur.battles += 1;
    if (lOutcome === "win") cur.leftWins += 1;
    else if (rOutcome === "win") cur.rightWins += 1;
    else if (lOutcome === "draw" || rOutcome === "draw") cur.draws += 1;
    else cur.unknowns += 1;
    cur.lastBattleTime = newerAllianceTime(cur.lastBattleTime, item.battleTime);
    statsByKey.set(key, cur);
  }
  return [...statsByKey.values()].sort((l, r) => r.battles - l.battles || l.key.localeCompare(r.key, "zh-Hans-CN"));
}

export function getAllianceMatchupView(stat: AllianceMatchupStat, filterKey: string): AllianceMatchupView {
  const showRight = filterKey !== "" && stat.rightKey === filterKey && stat.leftKey !== filterKey;
  const wins = showRight ? stat.rightWins : stat.leftWins;
  const losses = showRight ? stat.leftWins : stat.rightWins;
  return {
    key: showRight ? `${stat.key}:right` : `${stat.key}:left`,
    primaryLabel: showRight ? stat.rightLabel : stat.leftLabel,
    opponentLabel: showRight ? stat.leftLabel : stat.rightLabel,
    battles: stat.battles, wins, losses, draws: stat.draws, unknowns: stat.unknowns,
    winRate: allianceWinRate(wins, losses, stat.draws),
    lastBattleTime: stat.lastBattleTime,
  };
}

// ── Streak stats ──

export function buildAllianceStreakStats(records: JsonRecord[], allianceNameFilter: string): AllianceStreakStat[] {
  const resolveFull = buildAllianceFullLineupResolver(records);
  const stats: AllianceStreakStat[] = [];

  for (const [index, record] of records.entries()) {
    if (!isAllianceBlockRecord(record)) continue;
    const pBid = getObjectField(record, "battleId");
    const c = asRecord(record["continuous"]);
    const battleCount = asNumber(c?.["battleCount"]) ?? asNumber(record["continuousBattleCount"]) ?? 0;
    const winBattleNum = asNumber(c?.["winBattleNum"]) ?? asNumber(record["continuousWinBattleNum"]) ?? 0;
    const chainMerit = asNumber(c?.["chainMerit"]) ?? asNumber(record["continuousChainMerit"]) ?? 0;
    if (Math.max(battleCount, winBattleNum) < 5 || chainMerit < 15000) continue;
    const side = (asString(c?.["side"]) || getObjectField(record, "continuousSide")) as AllianceSidePrefix | "";
    if (!side || (side !== "attack" && side !== "defend") || !sideMatchesAllianceFilter(record, side, allianceNameFilter)) continue;
    const identity = getAllianceLineupIdentity(record, side);
    if (!identity) continue;
    const resolved = resolveFull(identity);
    stats.push({
      key: `${getAllianceRecordKey(record, index)}:${side}`,
      label: resolved.label || identity.label,
      player: getAllianceSidePlayerName(record, side),
      alliance: getAllianceSideAllianceName(record, side),
      side, battleCount, winBattleNum, chainMerit,
      totalMerit: asNumber(c?.["totalMerit"]) ?? asNumber(record["continuousTotalMerit"]) ?? 0,
      killNum: asNumber(c?.["killNum"]) ?? asNumber(record["continuousKillNum"]) ?? 0,
      finalBattleMerit: asNumber(c?.["finalBattleMerit"]) ?? asNumber(record["continuousFinalBattleMerit"]) ?? 0,
      battleTime: getAllianceBattleTime(record),
      location: getObjectField(record, "territory", "location", "coord"),
      parentBattleId: pBid,
    });
  }
  return stats.sort((l, r) => r.chainMerit - l.chainMerit || r.winBattleNum - l.winBattleNum);
}

// ── Sort ──

export function getAllianceLineupSortValue(stat: AllianceLineupStat, key: AllianceLineupSortKey): number {
  switch (key) {
    case "battles": return stat.battles;
    case "winRate": return allianceWinRate(stat.wins, stat.losses, stat.draws);
    case "merit": return stat.totalMerit ?? 0;
    case "averageEvolution": return stat.evolutionCount > 0 ? stat.totalEvolution / stat.evolutionCount : 0;
    case "averageHeroLevel": return (stat.heroLevelCount ?? 0) > 0 ? (stat.totalHeroLevel ?? 0) / (stat.heroLevelCount ?? 1) : 0;
    case "averageCasualties": return stat.battles > 0 ? (stat.totalWounded + stat.totalDead) / stat.battles : 0;
    case "lossRate": return getAllianceLossRate(stat.totalDead, stat.totalWounded, stat.totalOriginTroops);
    case "enemyLossRate": return getAllianceEnemyLossRate(stat.totalEnemyDead, stat.totalEnemyWounded, stat.totalEnemyOriginTroops);
    case "lossExchangeRatio": {
      const own = getAllianceLossRate(stat.totalDead, stat.totalWounded, stat.totalOriginTroops);
      const enemy = getAllianceEnemyLossRate(stat.totalEnemyDead, stat.totalEnemyWounded, stat.totalEnemyOriginTroops);
      return own > 0 ? enemy / own : (enemy > 0 ? Infinity : 0);
    }
    case "lastBattleTime": return parseTimeForSort(stat.lastBattleTime);
    default: return 0;
  }
}

export function sortAllianceLineupStats(stats: AllianceLineupStat[], sort: AllianceLineupSort): AllianceLineupStat[] {
  return [...stats].sort((l, r) => {
    const lv = getAllianceLineupSortValue(l, sort.key), rv = getAllianceLineupSortValue(r, sort.key);
    const vd = sort.direction === "asc" ? lv - rv : rv - lv;
    if (vd !== 0) return vd;
    const bd = r.battles - l.battles;
    if (bd !== 0) return bd;
    const rd = allianceWinRate(r.wins, r.losses, r.draws) - allianceWinRate(l.wins, l.losses, l.draws);
    if (rd !== 0) return rd;
    return l.label.localeCompare(r.label, "zh-Hans-CN");
  });
}

export function nextAllianceLineupSort(current: AllianceLineupSort, key: AllianceLineupSortKey): AllianceLineupSort {
  if (current.key !== key) return { key, direction: "desc" };
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

// ── CSV export ──

export function buildAllianceCsv(records: JsonRecord[]): string {
  const header = [
    "战斗Key", "时间", "地点", "结果", "胜方",
    "攻方同盟", "攻方玩家", "攻方阵型", "攻方阵容", "攻方武将ID", "攻方等级", "攻方武勋", "攻方剩余", "攻方原始兵力", "攻方伤兵", "攻方阵亡",
    "守方同盟", "守方玩家", "守方阵型", "守方阵容", "守方武将ID", "守方等级", "守方武勋", "守方剩余", "守方原始兵力", "守方伤兵", "守方阵亡",
    "回合", "父战报", "连战方", "连战场次", "连战武勋",
  ];
  const rows = records.map((record, index) => {
    const at = getAllianceSideTroopTotals(record, "attack");
    const dt = getAllianceSideTroopTotals(record, "defend");
    return [
      getAllianceRecordKey(record, index), getAllianceBattleTime(record),
      getObjectField(record, "territory", "location", "coord"),
      getObjectField(record, "result", "battleResult") || "交战", getAllianceWinnerLabel(record),
      getAllianceSideAllianceName(record, "attack"), getAllianceSidePlayerName(record, "attack"),
      formatAllianceFormationLabel(getAllianceSideFormationId(record, "attack"), getAllianceSideFormationName(record, "attack")),
      getAllianceSideLineupLabel(record, "attack"), getAllianceSideLineupIds(record, "attack").join("/"),
      getAllianceSideHeroLevels(record, "attack").join("/"), getAllianceSideMerit(record, "attack"),
      at.remainingTroops, at.originTroops, at.wounded, at.dead,
      getAllianceSideAllianceName(record, "defend"), getAllianceSidePlayerName(record, "defend"),
      formatAllianceFormationLabel(getAllianceSideFormationId(record, "defend"), getAllianceSideFormationName(record, "defend")),
      getAllianceSideLineupLabel(record, "defend"), getAllianceSideLineupIds(record, "defend").join("/"),
      getAllianceSideHeroLevels(record, "defend").join("/"), getAllianceSideMerit(record, "defend"),
      dt.remainingTroops, dt.originTroops, dt.wounded, dt.dead,
      getNumericField(record, "endRound") ?? "", getObjectField(record, "parentBattleId"),
      "", "", "",
    ];
  });
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}
