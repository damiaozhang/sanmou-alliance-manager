/**
 * S5 同盟健康度评分（纯前端聚合）。
 *
 * 输入现有数据（无需新采集）：
 *   - memberSnapshots：成员快照时间序列（online / 坐标 / 贡献）
 *   - lineupAnalysis.stats：玩家阵容统计（红度 avgEvolution）
 *   - captureSessions：采集会话（活跃度代理）
 *
 * 输出 0-100 总分 + 四个分项：
 *   - onlineTrend    在线率趋势（最近 vs 早期）
 *   - redSpread      红度分布（平均红度，越高越好）
 *   - attritionSlope 成员流失斜率（快照人数随时间的变化）
 *   - joinLeaveRate  入盟/离盟活跃度（快照成员集合变化率）
 *
 * 纯函数、无副作用、无 React 依赖，便于单测。
 */

import type { CaptureSessionRow, LineupAnalysisBundle, MemberSnapshotRow } from "../tauri";

// 阶段3b：memberSnapshots 不再随 bundle 下发，改由 get_member_snapshots 分片命令供数
type Snapshot = MemberSnapshotRow;
type Session = CaptureSessionRow;

export interface HealthFacets {
  onlineTrend: number; // 0-100
  redSpread: number; // 0-100
  attritionSlope: number; // 0-100（越高越健康，即人数稳定/增长）
  joinLeaveRate: number; // 0-100（越高越活跃）
}

export interface HealthResult {
  score: number; // 0-100
  facets: HealthFacets;
  /** 每项的分项说明，用于 UI 展示 */
  notes: Record<keyof HealthFacets, string>;
}

/** 按 observedAt 排序的分组快照：Map<observedAt, Snapshot[]> */
export function groupSnapshotsByTime(snapshots: Snapshot[]): Map<string, Snapshot[]> {
  const groups = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const key = s.observedAt || "unknown";
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return groups;
}

/** 在线率：给定快照组中 isOnline === 1 的比例（0-1），空组返回 0。 */
export function onlineRate(group: Snapshot[]): number {
  if (group.length === 0) return 0;
  return group.filter((s) => s.isOnline === 1).length / group.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 健康度主入口。所有分项 0-100，加权汇总为总分。
 */
export function computeHealth(
  snapshots: Snapshot[],
  stats: LineupAnalysisBundle["stats"],
  sessions: Session[]
): HealthResult {
  const groups = [...groupSnapshotsByTime(snapshots).entries()]
    .filter(([time]) => time !== "unknown")
    .sort((a, b) => a[0].localeCompare(b[0]));

  // ── onlineTrend：最近一组 vs 最早一组在线率对比 ──
  let onlineTrend = 50;
  let onlineNote = "快照不足，无法评估在线趋势";
  if (groups.length >= 2) {
    const first = onlineRate(groups[0][1]);
    const last = onlineRate(groups[groups.length - 1][1]);
    onlineTrend = Math.round(clamp01(0.5 + (last - first)) * 100);
    onlineNote = `在线率 ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%`;
  } else if (groups.length === 1) {
    const only = onlineRate(groups[0][1]);
    onlineTrend = Math.round(clamp01(only) * 100);
    onlineNote = `当前在线率 ${(only * 100).toFixed(0)}%（仅一次快照）`;
  }

  // ── redSpread：平均红度（用阵容 avgEvolution 均值，越高越强）──
  let redSpread = 50;
  let redNote = "暂无阵容数据，红度评分为中性";
  if (stats.length > 0) {
    const totalBattles = stats.reduce((sum, s) => sum + s.battles, 0);
    const weighted = totalBattles > 0
      ? stats.reduce((sum, s) => sum + s.avgEvolution * s.battles, 0) / totalBattles
      : stats.reduce((sum, s) => sum + s.avgEvolution, 0) / stats.length;
    // avgEvolution 约 0-6（满红 6），线性映射到 0-100
    redSpread = Math.round(clamp01(weighted / 6) * 100);
    redNote = `平均红度 ${weighted.toFixed(1)}`;
  }

  // ── attritionSlope：成员数随时间的斜率（负斜率 = 流失）──
  let attritionSlope = 50;
  let attritionNote = "快照不足，无法评估人数趋势";
  if (groups.length >= 2) {
    const firstCount = groups[0][1].length;
    const lastCount = groups[groups.length - 1][1].length;
    // 人数稳定/增长 → 高分；流失过半 → 低分
    const ratio = firstCount > 0 ? lastCount / firstCount : 1;
    attritionSlope = Math.round(clamp01(ratio) * 100);
    attritionNote = `成员数 ${firstCount} → ${lastCount}`;
  } else if (groups.length === 1) {
    attritionSlope = 60;
    attritionNote = `当前成员 ${groups[0][1].length} 人（仅一次快照）`;
  }

  // ── joinLeaveRate：采集会话活跃度代理（最近 14 天有完成采集即活跃）──
  let joinLeaveRate = 50;
  let joinLeaveNote = "暂无采集会话";
  if (sessions.length > 0) {
    const now = Date.now();
    const fourteenDays = 14 * 86_400_000;
    const recent = sessions.filter((s) => {
      const t = new Date(s.startedAt).getTime();
      return Number.isFinite(t) && now - t <= fourteenDays;
    }).length;
    // 14 天内 ≥3 次采集视为非常活跃
    joinLeaveRate = Math.round(clamp01(recent / 3) * 100);
    joinLeaveNote = `近 14 天 ${recent} 次采集`;
  }

  // ── 总分：四维度加权 ──
  const score = Math.round(
    onlineTrend * 0.3 + redSpread * 0.3 + attritionSlope * 0.25 + joinLeaveRate * 0.15
  );

  return {
    score,
    facets: { onlineTrend, redSpread, attritionSlope, joinLeaveRate },
    notes: {
      onlineTrend: onlineNote,
      redSpread: redNote,
      attritionSlope: attritionNote,
      joinLeaveRate: joinLeaveNote,
    },
  };
}

/** 分数 → 语义标签与配色（供 UI 用，与 Badge variant 对齐）。 */
export function healthTone(score: number): {
  label: string;
  tone: "success" | "info" | "warning" | "destructive";
} {
  if (score >= 75) return { label: "健康", tone: "success" };
  if (score >= 55) return { label: "稳定", tone: "info" };
  if (score >= 35) return { label: "预警", tone: "warning" };
  return { label: "告急", tone: "destructive" };
}
