// 同盟成员展示建模（阶段4 自 helpers.ts 拆出）

import {
  type WeeklyStatKey,
  type WeeklyStatSummary,
  summarizeWeeklyStatistics,
  weeklyStatSortValue
} from "./weeklyStats";

export type MemberSortKey = "lastOfflineTs" | "prosperity" | "contribution" | "merit" | "seasonScore" | "tFeat";
export type CargoSortKey = "tFeat" | "tForageUse" | "cargoRatio";
/** 周维度表的排序列：本周任一指标 + 环比 */
export type WeeklySortKey = WeeklyStatKey | "featDeltaRatio";

export type AllianceDisplayMember = {
  avatarId: string;
  name: string;
  official: string;
  profession: string;
  isOnline: number;
  legion: string;
  /** 军团 ID。游戏侧 legion_name 经常为空，必须保留 id 才能正确分组（见 resolveLegionLabel） */
  legionId: number;
  prosperity: number;
  contribution: number;
  merit: number;
  seasonScore: number;
  lastOfflineTs: number;
  joinTs: number;
  tFeat: number;
  tForageUse: number;
  wForageUse: number;
  weeklyStatisticsJson: string;
  /**
   * 解析后的周维度序列（本周在 [0]，按周起始时间降序）。
   * 为 null 表示该成员没有任何有效周数据 —— 与"本周全 0"是两码事，展示时必须区分。
   */
  weeklySummary: WeeklyStatSummary | null;
  demolition: number;
  coord: string;
  status: string;
  cargoRatio: number;
};

export function buildAllianceDisplayMember(source: {
  avatarId?: string | null;
  name: string;
  official?: string | null;
  profession?: string | null;
  isOnline?: number | null;
  legion?: string | null;
  legionId?: number | null;
  prosperity?: number | null;
  contribution?: number | null;
  merit?: number | null;
  seasonScore?: number | null;
  lastOfflineTs?: number | null;
  joinTs?: number | null;
  tFeat?: number | null;
  tForageUse?: number | null;
  wForageUse?: number | null;
  weeklyStatisticsJson?: string | null;
  demolition?: number | null;
  coord?: string | null;
  status?: string | null;
}): AllianceDisplayMember {
  const tFeat = source.tFeat ?? 0;
  const tForageUse = source.tForageUse ?? 0;
  const weeklyStatisticsJson = source.weeklyStatisticsJson ?? "";
  return {
    avatarId: source.avatarId ?? "",
    name: source.name,
    official: source.official?.trim() || "",
    profession: source.profession?.trim() || "",
    isOnline: source.isOnline ?? 0,
    legion: source.legion?.trim() || "",
    legionId: source.legionId ?? 0,
    prosperity: source.prosperity ?? 0,
    contribution: source.contribution ?? 0,
    merit: source.merit ?? 0,
    seasonScore: source.seasonScore ?? 0,
    lastOfflineTs: source.lastOfflineTs ?? 0,
    joinTs: source.joinTs ?? 0,
    tFeat,
    tForageUse,
    wForageUse: source.wForageUse ?? 0,
    weeklyStatisticsJson,
    weeklySummary: summarizeWeeklyStatistics(weeklyStatisticsJson),
    demolition: source.demolition ?? 0,
    coord: source.coord?.trim() || "",
    status: source.status?.trim() || "",
    cargoRatio: tForageUse > 0 ? tFeat / tForageUse : 0
  };
}

/**
 * 从成员列表推导 legion_id → 军团名 映射（每个 id 取出现次数最多的非空名称）。
 * 游戏侧 `legion_name` 经常为空（实测 DB 里多数行为空），但 `legion_id` 一直有效，
 * 所以用它把缺名的成员补回正确军团，避免「分组」列与筛选全是空。
 */
export function buildLegionNameIndex(
  members: Array<{ legionId?: number | null; legion?: string | null }>
): Map<number, string> {
  const buckets = new Map<number, Map<string, number>>();
  for (const member of members) {
    const id = member.legionId ?? 0;
    const name = (member.legion ?? "").trim();
    if (id <= 0 || !name) continue;
    const bucket = buckets.get(id) ?? new Map<string, number>();
    bucket.set(name, (bucket.get(name) ?? 0) + 1);
    buckets.set(id, bucket);
  }
  const index = new Map<number, string>();
  for (const [id, bucket] of buckets) {
    let best = "";
    let bestCount = -1;
    for (const [name, count] of bucket) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    if (best) index.set(id, best);
  }
  return index;
}

/**
 * 解析成员的军团展示名：自身 legion_name → 同 legion_id 的已知名称 → 「军团{id}」。
 * id 为 0/空表示未分配，返回空串（由调用方渲染成「未分配」）。
 */
export function resolveLegionLabel(
  member: { legion?: string | null; legionId?: number | null },
  index?: Map<number, string>
): string {
  const name = (member.legion ?? "").trim();
  if (name) return name;
  const id = member.legionId ?? 0;
  if (id <= 0) return "";
  return index?.get(id) ?? `军团${id}`;
}

/** 给成员列表补齐军团展示名（保留 legionId 不变，便于按 id 分组）。 */
export function applyLegionLabels<T extends { legion?: string | null; legionId?: number | null }>(
  members: T[]
): T[] {
  const index = buildLegionNameIndex(members);
  return members.map((member) => ({ ...member, legion: resolveLegionLabel(member, index) }));
}

export function normalizeMemberFilterValue(value: string | null | undefined) {  const text = String(value ?? "").trim();
  return text.length > 0 ? text : "__empty__";
}

export function buildMemberFilterOptions(
  rows: AllianceDisplayMember[],
  getValue: (row: AllianceDisplayMember) => string,
  emptyLabel: string
) {
  const values = new Set<string>();
  let hasEmpty = false;
  for (const row of rows) {
    const value = getValue(row).trim();
    if (value) {
      values.add(value);
    } else {
      hasEmpty = true;
    }
  }
  const sorted = [...values].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  return [
    ...(hasEmpty ? [{ value: "__empty__", label: emptyLabel }] : []),
    ...sorted.map((value) => ({ value, label: value }))
  ];
}

export function isAllianceMemberOnline(member: AllianceDisplayMember) {
  return member.isOnline === 1 || /在线|online/i.test(member.status);
}

export function memberSortValue(member: AllianceDisplayMember, key: MemberSortKey) {
  switch (key) {
    case "lastOfflineTs": return member.lastOfflineTs;
    case "prosperity": return member.prosperity;
    case "contribution": return member.contribution;
    case "merit": return member.merit;
    case "seasonScore": return member.seasonScore;
    case "tFeat": return member.tFeat;
  }
}

export function cargoSortValue(member: AllianceDisplayMember, key: CargoSortKey) {
  switch (key) {
    case "tFeat": return member.tFeat;
    case "tForageUse": return member.tForageUse;
    case "cargoRatio": return member.cargoRatio;
  }
}

// ── 周统计数据解析/展示（游戏协议 JSON） ──
//
// 2026-09-21：原实现只取 `[number]1`（"当前周"）并忽略其余周次，"周维度统计"实际只呈现出
// 一周，且跨周后序号整体右移会导致口径漂移。现改为统一走 `weeklyStats.ts` 的
// **按 timestamp 排序的序列**，本文件只保留展示层适配。

export { type WeeklyStat, type WeeklyStatSummary, type WeeklyStatKey } from "./weeklyStats";

/** 兼容旧签名：返回"本周"扁平对象，供仍需原始键值对的老调用点使用 */
export function parseWeeklyStatistics(value?: string | null): Record<string, unknown> | null {
  const weeks = summarizeWeeklyStatistics(value);
  if (!weeks?.current) return null;
  return { ...weeks.current };
}

export function weeklyStatNumber(stats: Record<string, unknown> | null, key: string) {
  const value = stats?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : 0;
  }
  return 0;
}

/** 成员列表里的紧凑一行（逐步被周维度表取代，保留给表格 hover / 导出预览） */
export function formatWeeklyStatistics(value?: string | null) {
  const summary = summarizeWeeklyStatistics(value);
  if (!summary?.current) return "-";
  const current = summary.current;
  const parts = [
    current.attack ? `攻${current.attack}` : "",
    current.seige ? `守${current.seige}` : "",
    current.demolish ? `拆${current.demolish}` : "",
    current.killNum ? `击${current.killNum}` : "",
    current.occupy ? `占${current.occupy}` : ""
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

/** 周维度表的排序取值 */
export function weeklySortValue(member: AllianceDisplayMember, key: WeeklySortKey) {
  const summary = member.weeklySummary;
  if (key === "featDeltaRatio") return summary?.featDeltaRatio ?? -Infinity;
  return weeklyStatSortValue(summary, key);
}

export type AllianceWeeklyTotals = {
  /** 有周数据的成员数（不等于成员总数） */
  coveredMembers: number;
  /** 本周战功合计 */
  feat: number;
  /** 本周贡献合计 */
  contri: number;
  /** 本周攻城值合计 */
  seige: number;
  /** 本周拆迁合计 */
  demolish: number;
  /** 本周歼敌合计 */
  killNum: number;
  /** 有环比可比样本的成员数 */
  comparableMembers: number;
  /** 战功环比中位数（占比为 -1..n 的小数），无可比样本时为 null */
  featDeltaRatioMedian: number | null;
};

/**
 * 汇总整个同盟的本周指标。
 * 只统计 `weeklySummary` 非空的成员 —— 没有周数据的成员如果按 0 计入，
 * 会把"没采到"伪装成"本周没打"，这是最需要避免的误读。
 */
export function summarizeAllianceWeekly(members: AllianceDisplayMember[]): AllianceWeeklyTotals {
  const totals: AllianceWeeklyTotals = {
    coveredMembers: 0,
    feat: 0,
    contri: 0,
    seige: 0,
    demolish: 0,
    killNum: 0,
    comparableMembers: 0,
    featDeltaRatioMedian: null
  };
  const ratios: number[] = [];
  for (const member of members) {
    const summary = member.weeklySummary;
    if (!summary?.current) continue;
    totals.coveredMembers += 1;
    totals.feat += summary.current.feat;
    totals.contri += summary.current.contri;
    totals.seige += summary.current.seige;
    totals.demolish += summary.current.demolish;
    totals.killNum += summary.current.killNum;
    if (summary.featDeltaRatio !== null) {
      totals.comparableMembers += 1;
      ratios.push(summary.featDeltaRatio);
    }
  }
  if (ratios.length > 0) {
    ratios.sort((left, right) => left - right);
    const middle = Math.floor(ratios.length / 2);
    totals.featDeltaRatioMedian =
      ratios.length % 2 === 0 ? (ratios[middle - 1] + ratios[middle]) / 2 : ratios[middle];
  }
  return totals;
}
