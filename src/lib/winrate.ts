import type { LineupMatchupRow } from "../tauri";
import { localDateKey } from "./dates";

// ════════ 统一胜率口径（单对单·攻方视角） ════════
// 项目既定口径（各页面收敛到此，避免口径漂移）：
//   默认单对单；平局计半胜；unknown 不计入分母；
//   攻方视角统一由 attackerOutcomeFromResult 解释（守方胜=我方负）。
// 新增导出，不影响既有导出（向后兼容）。

export type WinRateOutcome = "win" | "loss" | "draw" | "unknown";

export interface WinRateSummary {
  /** 已知场次（win+loss+draw），unknown 不计入分母 */
  total: number;
  wins: number;
  losses: number;
  draws: number;
  /** (wins + draws*0.5)/total，total 为 0 时返回 0 */
  winRate: number;
}

/** 按统一口径聚合一组攻方 outcome；unknown 跳过（不入分母）。 */
export function summarizeWinRate(outcomes: WinRateOutcome[]): WinRateSummary {
  let wins = 0, losses = 0, draws = 0, total = 0;
  for (const o of outcomes) {
    if (o === "win") { wins += 1; total += 1; }
    else if (o === "loss") { losses += 1; total += 1; }
    else if (o === "draw") { draws += 1; total += 1; }
    // unknown 不计入
  }
  return { total, wins, losses, draws, winRate: total > 0 ? (wins + draws * 0.5) / total : 0 };
}

export interface DailyWinRate extends WinRateSummary {
  date: string;
}

/**
 * 按本地日期桶聚合每日胜率（修复 S3-1 UTC 偏移：用 localDateKey 而非 toISOString）。
 * getDateKey / getOutcome 由调用方提供，兼容 BattleReportRow 与阵容对阵两种数据源。
 */
export function aggregateDailyWinRate<T>(
  battles: T[],
  getDateKey: (b: T) => string,
  getOutcome: (b: T) => WinRateOutcome,
  days = 7,
): { daily: DailyWinRate[]; overall: WinRateSummary } {
  const now = new Date();
  const buckets = new Map<string, DailyWinRate>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    buckets.set(key, { date: key, total: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });
  }
  for (const b of battles) {
    const bucket = buckets.get(getDateKey(b));
    if (!bucket) continue;
    const o = getOutcome(b);
    if (o === "win") { bucket.wins += 1; bucket.total += 1; }
    else if (o === "loss") { bucket.losses += 1; bucket.total += 1; }
    else if (o === "draw") { bucket.draws += 1; bucket.total += 1; }
  }
  const daily = [...buckets.values()].map((b) => ({ ...b, winRate: b.total > 0 ? (b.wins + b.draws * 0.5) / b.total : 0 }));
  return { daily, overall: summarizeWinRate(battles.map(getOutcome)) };
}


// ════════ 阵容胜率矩阵（攻击方阵容 × 防守方阵容） ════════

export interface WinRateCell {
  wins: number;
  losses: number;
  draws: number;
  battles: number;
  /** 胜率 = (wins + draws * 0.5) / battles（平局计半胜，与 MatchupTab/AutoLineupTab/排行口径一致；无场次时为 0） */
  winRate: number;
}

export interface WinRateMatrix {
  /** 攻击方阵容 key，按总场次降序 */
  attackerKeys: string[];
  /** 防守方阵容 key，按总场次降序 */
  defenderKeys: string[];
  /** key -> 展示标签 */
  labels: Record<string, string>;
  /** cells[attackerKey][defenderKey] */
  cells: Record<string, Record<string, WinRateCell>>;
}

export interface CounterPick {
  attackerKey: string;
  attackerLabel: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface CounterRecommendation {
  defenderKey: string;
  defenderLabel: string;
  /** 该防守方阵容的总被攻场次 */
  totalBattles: number;
  /** totalBattles >= minBattles 时为 true，否则样本不足 */
  sufficient: boolean;
  picks: CounterPick[];
}

export const MIN_COUNTER_SAMPLE = 3;

function emptyCell(): WinRateCell {
  return { wins: 0, losses: 0, draws: 0, battles: 0, winRate: 0 };
}

function applyOutcome(cell: WinRateCell, outcome: string): void {
  // unknown 不计入分母，避免稀释胜率（终审口径：已知场次 = win + loss + draw）
  if (outcome !== "win" && outcome !== "loss" && outcome !== "draw") return;
  cell.battles += 1;
  if (outcome === "win") cell.wins += 1;
  else if (outcome === "loss") cell.losses += 1;
  else cell.draws += 1;
  // 平局计半胜，与 MatchupTab/AutoLineupTab/玩家排行保持一致
  cell.winRate = cell.battles > 0 ? (cell.wins + cell.draws * 0.5) / cell.battles : 0;
}

function cellFrom(attackerKey: string, attackerLabel: string, cell: WinRateCell): CounterPick {
  return {
    attackerKey,
    attackerLabel,
    battles: cell.battles,
    wins: cell.wins,
    losses: cell.losses,
    draws: cell.draws,
    winRate: cell.winRate,
  };
}

/** 从逐场对阵记录构建 攻击方阵容 × 防守方阵容 胜率矩阵。 */
export function buildWinRateMatrix(matchups: LineupMatchupRow[]): WinRateMatrix {
  const cells: Record<string, Record<string, WinRateCell>> = {};
  const labels: Record<string, string> = {};
  const attackerTotals = new Map<string, number>();
  const defenderTotals = new Map<string, number>();

  for (const m of matchups) {
    const aKey = m.attackerLineupKey;
    const dKey = m.defenderLineupKey;
    if (!aKey || !dKey) continue;
    if (!labels[aKey]) labels[aKey] = m.attackerLineupLabel || "未知阵容";
    if (!labels[dKey]) labels[dKey] = m.defenderLineupLabel || "未知阵容";

    const row = cells[aKey] ?? (cells[aKey] = {});
    const cell = row[dKey] ?? (row[dKey] = emptyCell());
    applyOutcome(cell, m.outcome);

    // 行列总场次与 applyOutcome 同口径：仅计 win/loss/draw，unknown 不参与
    if (m.outcome === "win" || m.outcome === "loss" || m.outcome === "draw") {
      attackerTotals.set(aKey, (attackerTotals.get(aKey) ?? 0) + 1);
      defenderTotals.set(dKey, (defenderTotals.get(dKey) ?? 0) + 1);
    }
  }

  const sortKeys = (keys: string[], totals: Map<string, number>) =>
    [...keys].sort((l, r) => {
      const td = (totals.get(r) ?? 0) - (totals.get(l) ?? 0);
      if (td !== 0) return td;
      return (labels[l] ?? l).localeCompare(labels[r] ?? r, "zh-Hans-CN");
    });

  return {
    attackerKeys: sortKeys([...attackerTotals.keys()], attackerTotals),
    defenderKeys: sortKeys([...defenderTotals.keys()], defenderTotals),
    labels,
    cells,
  };
}

/**
 * 克制推荐：对每个出现过的防守方阵容，列出对它胜率最高的攻击方阵容 Top N。
 * 防守方总场次不足 minBattles 时标记为样本不足（sufficient=false，不给推荐）。
 */
export function buildCounterRecommendations(
  matrix: WinRateMatrix,
  minBattles = MIN_COUNTER_SAMPLE,
  topN = 3
): CounterRecommendation[] {
  const result: CounterRecommendation[] = [];

  for (const defenderKey of matrix.defenderKeys) {
    let totalBattles = 0;
    const picks: CounterPick[] = [];
    for (const attackerKey of matrix.attackerKeys) {
      const cell = matrix.cells[attackerKey]?.[defenderKey];
      if (!cell || cell.battles === 0) continue;
      totalBattles += cell.battles;
      picks.push(cellFrom(attackerKey, matrix.labels[attackerKey] ?? "未知阵容", cell));
    }

    const sufficient = totalBattles >= minBattles;
    const sorted = sufficient
      ? [...picks].sort((l, r) => {
          const wr = r.winRate - l.winRate;
          if (wr !== 0) return wr;
          const bd = r.battles - l.battles;
          if (bd !== 0) return bd;
          return l.attackerLabel.localeCompare(r.attackerLabel, "zh-Hans-CN");
        }).slice(0, Math.max(1, topN))
      : [];

    result.push({
      defenderKey,
      defenderLabel: matrix.labels[defenderKey] ?? "未知阵容",
      totalBattles,
      sufficient,
      picks: sorted,
    });
  }

  return result;
}

// ════════ V2：Wilson 置信区间 + 时间衰减 + 红度差修正（S1 智能克制推荐引擎） ════════

/** 单尾 95% 置信的 z 值 */
export const WILSON_Z = 1.64485;
/**
 * 时间衰减常数（天）：指数衰减 e^(-t/TAU) 的时间常数 τ，
 * 30 天前的战报权重降为 e^-1 ≈ 0.37。注意：它不是半衰期
 * （半衰期为 τ·ln2 ≈ 20.8 天），旧名 TIME_DECAY_HALF_DAYS 名不符实，已改名。
 */
export const TIME_DECAY_TAU_DAYS = 30;
/** 红度差每 +1 红对得分的加分系数 */
export const RED_DIFF_WEIGHT = 0.02;

export interface CounterPickV2 {
  attackerKey: string;
  attackerLabel: string;
  /** 原始场次 */
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  /** 原始胜率（平局计半胜） */
  winRate: number;
  /** 加权场次（时间衰减后） */
  weightedBattles: number;
  /** 加权胜率 */
  weightedWinRate: number;
  /** Wilson 95% 置信区间下界（0~1） */
  wilsonLB: number;
  /** 红度差修正后的综合得分 */
  score: number;
  /** 人话推荐理由 */
  reason: string;
}

export interface CounterRecommendationV2 {
  defenderKey: string;
  defenderLabel: string;
  totalBattles: number;
  sufficient: boolean;
  picks: CounterPickV2[];
}

export interface CounterPickV2Options {
  /** 红度差（攻击方平均红度 - 防守方平均红度），缺省 0 */
  redDiff?: number;
  /** 权重参考时间（ISO），用于时间衰减；缺省用当前时间 */
  now?: number;
  topN?: number;
}

/** Wilson 95% 单尾置信区间下界（平局计半胜，n=0 时返回 0） */
export function wilsonLowerBound(wins: number, n: number, z = WILSON_Z): number {
  if (n <= 0) return 0;
  const phat = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return Math.max(0, (center - margin) / denom);
}

/** 时间衰减权重：battleTime 距今越远权重越低，30 天前 ≈ e^-1 ≈ 0.37 */
export function timeDecayWeight(battleTime: string, now: number = Date.now()): number {
  // 约定：battleTime 为本地时间字符串（如 "2026-08-01 10:00:00"），补 "T" 后
  // 无时区后缀，JS Date 按本地时区解析；与采集端写入的本地时间一致，勿改为 UTC。
  const t = new Date(battleTime.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return 1;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.exp(-days / TIME_DECAY_TAU_DAYS);
}

/**
 * 克制推荐 V2：对每个防守方阵容，按「Wilson 下界 + 红度差修正」得分排序推荐。
 * 相比 V1 纯胜率排序，V2 会惩罚小样本（3 场 100% 胜率不再直接登顶），
 * 并优先近 14 天战报，红度优势会小幅加分。
 */
export function buildCounterRecommendationsV2(
  matchups: LineupMatchupRow[],
  opts: CounterPickV2Options = {}
): CounterRecommendationV2[] {
  const now = opts.now ?? Date.now();
  const topN = opts.topN ?? 3;

  // 聚合：attackerKey x defenderKey -> 加权胜/场次 + 原始计数
  const cellMap = new Map<string, {
    aKey: string; dKey: string;
    wins: number; losses: number; draws: number; battles: number;
    weightedWins: number; weightedBattles: number;
  }>();
  const labels = new Map<string, string>();
  const defenderTotals = new Map<string, number>();

  for (const m of matchups) {
    const aKey = m.attackerLineupKey;
    const dKey = m.defenderLineupKey;
    if (!aKey || !dKey) continue;
    // unknown 完全跳过，不计入场次/加权（与 applyOutcome 同口径）
    if (m.outcome !== "win" && m.outcome !== "loss" && m.outcome !== "draw") continue;
    const key = `${aKey}__${dKey}`;
    if (!labels.has(aKey)) labels.set(aKey, m.attackerLineupLabel || "未知阵容");
    if (!labels.has(dKey)) labels.set(dKey, m.defenderLineupLabel || "未知阵容");

    let cell = cellMap.get(key);
    if (!cell) {
      cell = { aKey, dKey, wins: 0, losses: 0, draws: 0, battles: 0, weightedWins: 0, weightedBattles: 0 };
      cellMap.set(key, cell);
    }
    cell.battles += 1;
    if (m.outcome === "win") cell.wins += 1;
    else if (m.outcome === "loss") cell.losses += 1;
    else cell.draws += 1;

    const w = timeDecayWeight(m.battleTime, now);
    cell.weightedBattles += w;
    if (m.outcome === "win") cell.weightedWins += w;
    else if (m.outcome === "draw") cell.weightedWins += w * 0.5;

    defenderTotals.set(dKey, (defenderTotals.get(dKey) ?? 0) + 1);
  }

  const defenderKeys = [...defenderTotals.keys()].sort((l, r) =>
    (defenderTotals.get(r) ?? 0) - (defenderTotals.get(l) ?? 0) ||
    (labels.get(l) ?? l).localeCompare(labels.get(r) ?? r, "zh-Hans-CN")
  );

  const result: CounterRecommendationV2[] = [];
  for (const dKey of defenderKeys) {
    const totalBattles = defenderTotals.get(dKey) ?? 0;
    const sufficient = totalBattles >= MIN_COUNTER_SAMPLE;
    if (!sufficient) {
      result.push({
        defenderKey: dKey,
        defenderLabel: labels.get(dKey) ?? "未知阵容",
        totalBattles,
        sufficient: false,
        picks: [],
      });
      continue;
    }

    const picks: CounterPickV2[] = [];
    for (const cell of cellMap.values()) {
      if (cell.dKey !== dKey || cell.battles === 0) continue;
      const winRate = (cell.wins + cell.draws * 0.5) / cell.battles;
      const weightedWinRate = cell.weightedBattles > 0 ? cell.weightedWins / cell.weightedBattles : winRate;
      const wilsonLB = wilsonLowerBound(cell.wins + cell.draws * 0.5, cell.battles);
      const redDiff = opts.redDiff ?? 0;
      const score = wilsonLB + RED_DIFF_WEIGHT * redDiff;

      const reason = buildCounterReason(cell, winRate, wilsonLB, redDiff);
      picks.push({
        attackerKey: cell.aKey,
        attackerLabel: labels.get(cell.aKey) ?? "未知阵容",
        battles: cell.battles,
        wins: cell.wins,
        losses: cell.losses,
        draws: cell.draws,
        winRate,
        weightedBattles: Number(cell.weightedBattles.toFixed(2)),
        weightedWinRate: Number(weightedWinRate.toFixed(4)),
        wilsonLB: Number(wilsonLB.toFixed(4)),
        score: Number(score.toFixed(4)),
        reason,
      });
    }

    picks.sort((l, r) => r.score - l.score || r.battles - l.battles ||
      l.attackerLabel.localeCompare(r.attackerLabel, "zh-Hans-CN"));
    result.push({
      defenderKey: dKey,
      defenderLabel: labels.get(dKey) ?? "未知阵容",
      totalBattles,
      sufficient: true,
      picks: picks.slice(0, Math.max(1, topN)),
    });
  }

  return result;
}

function buildCounterReason(
  cell: { battles: number; wins: number; losses: number; draws: number; weightedBattles: number },
  winRate: number,
  wilsonLB: number,
  redDiff: number
): string {
  const pct = (rate: number) => `${Math.round(rate * 100)}%`;
  const parts: string[] = [];
  if (cell.battles >= 10) {
    parts.push(`${cell.battles} 战 ${cell.wins} 胜（置信下界 ${pct(wilsonLB)}）`);
  } else {
    parts.push(`${cell.battles} 战 ${cell.wins} 胜`);
  }
  if (Math.abs(redDiff) >= 0.3) {
    parts.push(redDiff > 0 ? `平均红度优势 ${redDiff.toFixed(1)}` : `平均红度劣势 ${Math.abs(redDiff).toFixed(1)}`);
  }
  if (winRate >= 0.6) {
    parts.push("胜率显著占优");
  } else if (winRate <= 0.4) {
    parts.push("胜率偏低，谨慎使用");
  }
  return parts.join("，");
}
