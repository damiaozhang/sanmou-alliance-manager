import { useCallback, useEffect, useRef } from "react";

import type { JsonRecord } from "../types";
import { ALLIANCE_SIDE_PREFIXES } from "../constants";
import {
  getAllianceLineupIdentity, getAllianceSidePlayerName, getAllianceSideAllianceName,
  getAllianceSideOutcome, getAllianceSideTroopTotals, getAllianceSideMerit,
  getAllianceSideEvolutionSummary, getAllianceBattleTime, getAllianceRecordKey,
  newerAllianceTime, isValidAllianceLineup,
} from "../utils/alliance";
import { formatErrorMessage } from "@/lib/format";
import {
  useSyncLineupStatsMutation,
  useSyncLineupMatchupsMutation,
  useSyncMemberBindingsMutation,
} from "@/app/mutations";
import type { LineupMatchupInput, SaveMemberBindingRequest } from "@/tauri";

export type PlayerLineupAcc = {
  avatarId: string;
  playerName: string;
  allianceName: string;
  lineupKey: string;
  label: string;
  formationId: string;
  formationName: string;
  heroIds: string[];
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  attackBattles: number;
  defendBattles: number;
  totalMerit: number;
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
  lastBattleTime: string;
};

type WorkspaceContextLike = {
  workspaceId: number;
  allianceId: number | null;
} | null;

type AppendClientLog = (level: "info" | "warn" | "error", message: string) => void;

/** 聚合同盟战报中每个玩家阵容的统计指标（22 字段累加器）。 */
export function aggregatePlayerLineupStats(records: JsonRecord[]): PlayerLineupAcc[] {
  const statsMap = new Map<string, PlayerLineupAcc>();

  for (const record of records) {
    for (const prefix of ALLIANCE_SIDE_PREFIXES) {
      const identity = getAllianceLineupIdentity(record, prefix);
      if (!identity || identity.ids.length < 3) continue;
      // 与 buildLineupMatchupInputs 终审口径一致：任一侧不满足 isValidAllianceLineup
      // （残队 < 3 将 / 武将等级不足 / 兵力不足或假兵力）则跳过，避免脏数据污染 lineup_stat。
      if (!isValidAllianceLineup(record, prefix)) continue;
      const avatarId = identity.avatarId;
      const playerName = identity.player || getAllianceSidePlayerName(record, prefix);
      const allianceName = getAllianceSideAllianceName(record, prefix);
      const lineupKey = identity.key;
      const playerKey = `${avatarId || playerName}__${lineupKey}`;
      const outcome = getAllianceSideOutcome(record, prefix);
      const ep = prefix === "attack" ? "defend" : "attack";
      const t = getAllianceSideTroopTotals(record, prefix);
      const et = getAllianceSideTroopTotals(record, ep);
      const merit = getAllianceSideMerit(record, prefix);
      const evo = getAllianceSideEvolutionSummary(record, prefix);
      const battleTime = getAllianceBattleTime(record);

      let acc = statsMap.get(playerKey);
      if (!acc) {
        acc = {
          avatarId, playerName, allianceName, lineupKey,
          label: identity.label,
          formationId: identity.formationId,
          formationName: identity.formationName,
          heroIds: identity.ids,
          battles: 0, wins: 0, losses: 0, draws: 0,
          attackBattles: 0, defendBattles: 0,
          totalMerit: 0,
          totalOriginTroops: 0, totalRemainingTroops: 0,
          totalWounded: 0, totalDead: 0,
          totalEnemyOriginTroops: 0, totalEnemyRemainingTroops: 0,
          totalEnemyWounded: 0, totalEnemyDead: 0,
          totalEvolution: 0, evolutionCount: 0,
          lastBattleTime: "",
        };
        statsMap.set(playerKey, acc);
      }
      acc.battles += 1;
      if (outcome === "win") acc.wins += 1;
      else if (outcome === "loss") acc.losses += 1;
      else if (outcome === "draw") acc.draws += 1;
      if (prefix === "attack") acc.attackBattles += 1;
      else acc.defendBattles += 1;
      acc.totalMerit += merit;
      acc.totalOriginTroops += t.originTroops;
      acc.totalRemainingTroops += t.remainingTroops;
      acc.totalWounded += t.wounded;
      acc.totalDead += t.dead;
      acc.totalEnemyOriginTroops += et.originTroops;
      acc.totalEnemyRemainingTroops += et.remainingTroops;
      acc.totalEnemyWounded += et.wounded;
      acc.totalEnemyDead += et.dead;
      acc.totalEvolution += evo.total;
      acc.evolutionCount += evo.count;
      acc.lastBattleTime = newerAllianceTime(acc.lastBattleTime, battleTime);
      if (!acc.playerName && playerName) acc.playerName = playerName;
      if (!acc.allianceName && allianceName) acc.allianceName = allianceName;
    }
  }

  return Array.from(statsMap.values());
}

/** 将聚合统计转换为批量 upsert 请求（纯函数，便于测试）。 */
export function buildLineupStatRequests(stats: PlayerLineupAcc[], wsId: number) {
  return stats.map((acc) => {
    const ownRate = acc.totalOriginTroops > 0 ? (acc.totalDead + acc.totalWounded) / acc.totalOriginTroops : 0;
    const enemyRate = acc.totalEnemyOriginTroops > 0 ? (acc.totalEnemyDead + acc.totalEnemyWounded) / acc.totalEnemyOriginTroops : 0;
    const lossExchangeRatio = ownRate > 0 ? enemyRate / ownRate : 0;
    return {
      workspaceId: wsId,
      avatarId: acc.avatarId,
      playerName: acc.playerName,
      allianceName: acc.allianceName,
      lineupKey: acc.lineupKey,
      label: acc.label,
      formationId: acc.formationId,
      formationName: acc.formationName,
      heroIds: acc.heroIds,
      heroLevels: [],
      avgEvolution: acc.evolutionCount > 0 ? acc.totalEvolution / acc.evolutionCount : 0,
      battles: acc.battles,
      wins: acc.wins,
      losses: acc.losses,
      draws: acc.draws,
      attackBattles: acc.attackBattles,
      defendBattles: acc.defendBattles,
      totalMerit: acc.totalMerit,
      totalOriginTroops: acc.totalOriginTroops,
      totalRemainingTroops: acc.totalRemainingTroops,
      totalWounded: acc.totalWounded,
      totalDead: acc.totalDead,
      totalEnemyOriginTroops: acc.totalEnemyOriginTroops,
      totalEnemyRemainingTroops: acc.totalEnemyRemainingTroops,
      totalEnemyWounded: acc.totalEnemyWounded,
      totalEnemyDead: acc.totalEnemyDead,
      lossExchangeRatio: Number.isFinite(lossExchangeRatio) ? lossExchangeRatio : 0,
      lastBattleTime: acc.lastBattleTime,
      notes: null,
    };
  });
}

/** 将玩家阵容统计转换为批量自动绑定请求（纯函数，便于测试）。 */
export function buildAutoBindingRequests(
  stats: PlayerLineupAcc[],
  wsId: number,
  allianceId: number | null,
): SaveMemberBindingRequest[] {
  return stats
    .filter((acc) => acc.avatarId && acc.playerName)
    .map((acc) => ({
      workspaceId: wsId,
      allianceId,
      avatarId: acc.avatarId,
      avatarName: acc.playerName,
      confidence: "自动绑定",
    }));
}

/**
 * 从战报 JSON 提取分类字段（S3 战报分类）。
 * combatType/scenarioId/endRound 顶层直取，location 可能是数组 [x, y] 或字符串。
 */
function extractBattleClassification(record: JsonRecord): {
  combatType: number;
  scenarioId: number;
  endRound: number;
  location: string;
} {
  const rawLocation = record["location"] ?? record["coord"] ?? record["territory"];
  let location = "";
  if (Array.isArray(rawLocation)) {
    location = rawLocation.filter((v): v is number | string => v != null).join(",");
  } else if (typeof rawLocation === "number") {
    location = String(rawLocation);
  } else if (typeof rawLocation === "string") {
    location = rawLocation;
  }
  return {
    combatType: typeof record["combatType"] === "number" ? record["combatType"] : 0,
    scenarioId: typeof record["scenarioId"] === "number" ? record["scenarioId"] : 0,
    endRound: typeof record["endRound"] === "number" ? record["endRound"] : 0,
    location,
  };
}

/**
 * 按每条同盟战报生成阵容对阵行（纯函数，便于测试）。
 * - 攻击方/防守方任一侧阵容信息缺失则跳过该条；
 * - 质量过滤（终审口径，阈值见 constants.ts）：任一侧不满足 isValidAllianceLineup
 *   （残队 < 3 将 / 武将等级不足 / 兵力不足或假兵力）则跳过，不入 lineup_matchup 库；
 * - outcome 以攻击方视角：攻方胜 = win，攻方负 = loss，平 = draw；
 * - battleCode 取真实战报码（recordKey/battleCode/combatCode/blockHash），缺失时退化为 record key。
 */
export function buildLineupMatchupInputs(records: JsonRecord[], wsId: number) {
  const inputs: LineupMatchupInput[] = [];
  records.forEach((record, index) => {
    const attacker = getAllianceLineupIdentity(record, "attack");
    const defender = getAllianceLineupIdentity(record, "defend");
    if (!attacker || !defender) return;
    if (!isValidAllianceLineup(record, "attack") || !isValidAllianceLineup(record, "defend")) return;
    const outcome = getAllianceSideOutcome(record, "attack");
    const cls = extractBattleClassification(record);
    inputs.push({
      workspaceId: wsId,
      attackerAvatarId: attacker.avatarId,
      attackerPlayerName: attacker.player,
      attackerLineupKey: attacker.key,
      attackerLineupLabel: attacker.label,
      defenderAvatarId: defender.avatarId,
      defenderPlayerName: defender.player,
      defenderLineupKey: defender.key,
      defenderLineupLabel: defender.label,
      outcome,
      battleTime: getAllianceBattleTime(record),
      battleCode: getAllianceRecordKey(record, index),
      matchType: 0,
      combatType: cls.combatType,
      scenarioId: cls.scenarioId,
      endRound: cls.endRound,
      location: cls.location,
    });
  });
  return inputs;
}

/**
 * 稳定同步指纹：对全部记录的 (recordKey, battleTime) 做 djb2 哈希。
 * 相比只取末条记录，中间记录变化也会改变指纹，避免漏同步。
 */
export function buildLineupSyncKey(
  records: JsonRecord[],
  wsId: number,
  allianceId: number | null,
): string {
  let hash = 5381;
  for (let i = 0; i < records.length; i++) {
    const part = `${getAllianceRecordKey(records[i], i)}|${getAllianceBattleTime(records[i])}`;
    for (let j = 0; j < part.length; j++) {
      hash = ((hash << 5) + hash + part.charCodeAt(j)) >>> 0;
    }
  }
  return `${wsId}|${allianceId ?? ""}|${records.length}|${hash}`;
}

/**
 * 监听同盟战报变化，聚合玩家阵容统计后持久化到数据库。
 * 阶段4：写操作统一走 mutations 体系（成功后自动失效 lineupAnalysis/summary 分片缓存），
 * 保留幂等去重（lastSyncedLineupKeyRef）与并发守卫（lineupSyncInFlightRef）。
 */
export function useLineupSync(
  records: JsonRecord[],
  workspaceContext: WorkspaceContextLike,
  desktopRuntime: boolean,
  appendClientLog: AppendClientLog,
): void {
  const lastSyncedLineupKeyRef = useRef("");
  const lineupSyncInFlightRef = useRef(false);
  // 并发守卫补丁：正在同步期间若 records 再次变化，先登记 pending，
  // 待本轮 finally 用最新参数重触发，避免变化被永久跳过（P1-2）。
  const pendingSyncRef = useRef(false);
  const latestParamsRef = useRef<{ records: JsonRecord[]; wsId: number; allianceId: number | null } | null>(null);
  const syncStatsMutation = useSyncLineupStatsMutation();
  const syncMatchupsMutation = useSyncLineupMatchupsMutation();
  const syncBindingsMutation = useSyncMemberBindingsMutation();

  const runSync = useCallback(async () => {
    const params = latestParamsRef.current;
    if (!params) return;
    const { records, wsId, allianceId } = params;
    if (records.length === 0 || !desktopRuntime) return;
    if (!wsId || wsId <= 0) {
      appendClientLog("warn", "跳过阵容统计同步：请先选择或创建工作区");
      return;
    }

    const syncKey = buildLineupSyncKey(records, wsId, allianceId);
    if (lastSyncedLineupKeyRef.current === syncKey) return;
    if (lineupSyncInFlightRef.current) {
      // 正在同步：本次变化先存为 pending，finally 中重触发
      pendingSyncRef.current = true;
      return;
    }
    lineupSyncInFlightRef.current = true;

    try {
      const stats = aggregatePlayerLineupStats(records);
      const statRequests = buildLineupStatRequests(stats, wsId);
      if (statRequests.length > 0) {
        await syncStatsMutation.mutateAsync(statRequests);
      }
      const matchupInputs = buildLineupMatchupInputs(records, wsId);
      const matchupCount = matchupInputs.length > 0 ? (await syncMatchupsMutation.mutateAsync(matchupInputs)) ?? 0 : 0;
      const bindingRequests = buildAutoBindingRequests(stats, wsId, allianceId);
      let bindingCount = 0;
      if (bindingRequests.length > 0) {
        try {
          bindingCount = await syncBindingsMutation.mutateAsync(bindingRequests);
        } catch (error) {
          // 自动绑定失败不阻断阵容统计同步（保持原有宽容语义）
          console.warn("[useLineupSync] 批量绑定失败：", error);
        }
      }
      appendClientLog("info", `阵容统计已同步：${stats.length} 条玩家阵容记录，${matchupCount} 条对阵，${bindingCount} 条自动绑定`);
      lastSyncedLineupKeyRef.current = syncKey;
    } catch (e) {
      appendClientLog("error", `阵容统计同步失败: ${formatErrorMessage(e)}`);
    } finally {
      lineupSyncInFlightRef.current = false;
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        // 用最新 records 重跑，避免并发期间的变化被永久跳过
        void runSync();
      }
    }
  }, [appendClientLog, desktopRuntime, syncBindingsMutation, syncMatchupsMutation, syncStatsMutation]);

  useEffect(() => {
    const wsIdRaw = workspaceContext?.workspaceId;
    const allianceId = workspaceContext?.allianceId ?? null;
    latestParamsRef.current = { records, wsId: wsIdRaw ?? 0, allianceId };
    void runSync();
  }, [appendClientLog, desktopRuntime, records, runSync, workspaceContext?.allianceId, workspaceContext?.workspaceId]);
}
