// 同盟成员「周维度统计」解析与建模。
//
// 数据来源：游戏协议 `SRPC_RPCReqUnionMemberInfoResponse` 里每个成员的
// `weeklyStaticsticsData`，由 collector 落成 `member_snapshot.weekly_statistics_json`。
//
// 游戏侧原始形态（Lua 序列化残留的 `[number]N` 键）：
//   {
//     "[number]1": { timestamp, feat, contri, seige, demolish, dismantle, attack, occupy, killNum, wipeOut },
//     "[number]2": { ... },   // 上一周
//     "[number]3": { ... }    // 上上周
//   }
// `[number]1` 是**本周**，序号越大越早。跨周后整组整体右移，所以**不能按序号判断周次**，
// 必须按 `timestamp`（周起始，Unix 秒）排序 —— 这是本模块存在的首要原因。

export type WeeklyStat = {
  /** 周起始时间戳（Unix 秒，游戏给的周一 0 点） */
  timestamp: number;
  /** 战功 */
  feat: number;
  /** 贡献 */
  contri: number;
  /** 攻城值 */
  seige: number;
  /** 拆迁值 */
  demolish: number;
  /** 拆除（多为 0，保留以便与协议对齐） */
  dismantle: number;
  /** 攻城次数 */
  attack: number;
  /** 占领次数 */
  occupy: number;
  /** 歼敌 */
  killNum: number;
  /** 剿灭 */
  wipeOut: number;
};

export type WeeklyStatKey = keyof Omit<WeeklyStat, "timestamp">;

export type WeeklyStatSummary = {
  /** 按 timestamp 降序，[0] 为本周 */
  weeks: WeeklyStat[];
  current: WeeklyStat | null;
  previous: WeeklyStat | null;
  /** 全部周次求和 */
  totals: Record<WeeklyStatKey, number>;
  /** 本周 - 上周（战功），无上周时为 null */
  featDelta: number | null;
  /** 本周战功环比（0.25 = +25%）；上周为 0 或无上周时为 null */
  featDeltaRatio: number | null;
  /** 本周 - 上周（贡献） */
  contriDelta: number | null;
};

export const WEEKLY_STAT_LABELS: Record<WeeklyStatKey, string> = {
  feat: "战功",
  contri: "贡献",
  seige: "攻城值",
  demolish: "拆迁",
  dismantle: "拆除",
  attack: "攻城次数",
  occupy: "占领",
  killNum: "歼敌",
  wipeOut: "剿灭"
};

/** 成员列表/周维度表里默认展示的列（顺序即展示顺序） */
export const WEEKLY_STAT_COLUMNS: WeeklyStatKey[] = [
  "feat",
  "contri",
  "seige",
  "demolish",
  "attack",
  "killNum",
  "occupy"
];

const NUMERIC_KEYS: WeeklyStatKey[] = [
  "feat",
  "contri",
  "seige",
  "demolish",
  "dismantle",
  "attack",
  "occupy",
  "killNum",
  "wipeOut"
];

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** 把一周的对象规范化；缺字段补 0，保证下游不必再判空 */
function normalizeWeek(raw: unknown): WeeklyStat | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const timestamp = toNumber(source.timestamp ?? source.time ?? source.weekStart);
  const week: WeeklyStat = {
    timestamp,
    feat: 0,
    contri: 0,
    seige: 0,
    demolish: 0,
    dismantle: 0,
    attack: 0,
    occupy: 0,
    killNum: 0,
    wipeOut: 0
  };
  let hasSignal = timestamp > 0;
  for (const key of NUMERIC_KEYS) {
    const value = toNumber(source[key]);
    week[key] = value;
    if (value !== 0) hasSignal = true;
  }
  // 完全没有信号（无时间戳且全 0）的占位周直接丢弃，避免把空壳当"上周"参与环比
  return hasSignal ? week : null;
}

/**
 * 解析 `weekly_statistics_json` 为**按周次降序**的数组。
 *
 * 兼容三种历史形态：
 * 1. `{"[number]1": {...}, ...}` —— 现行协议（Lua 序列化）；
 * 2. `{"1": {...}, "current": {...}}` —— 旧版/手工构造；
 * 3. 单周扁平对象 `{"feat": 1, ...}` —— 早期落库与测试夹具；
 * 4. 直接是数组 `[{...}, {...}]` —— 未来协议若改为数组也无需改调用方。
 *
 * 无法解析时返回 `[]`（调用方按"无周数据"处理，不抛异常）。
 */
export function parseWeeklyStatisticsSeries(value?: string | null): WeeklyStat[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return weeklySeriesFromValue(parsed);
}

export function weeklySeriesFromValue(parsed: unknown): WeeklyStat[] {
  if (Array.isArray(parsed)) {
    return sortWeeksDesc(parsed.map(normalizeWeek).filter((week): week is WeeklyStat => week !== null));
  }
  if (!parsed || typeof parsed !== "object") return [];

  const source = parsed as Record<string, unknown>;
  const collected: WeeklyStat[] = [];

  for (const [key, raw] of Object.entries(source)) {
    if (!key.startsWith("[number]") && !/^\d+$/.test(key)) continue;
    const week = normalizeWeek(raw);
    if (week) collected.push(week);
  }

  if (collected.length === 0) {
    // 形态 3：扁平单周对象（无 timestamp 则补 0，仍然可用）
    const flat = normalizeWeek(source);
    if (flat) return [flat];
    return [];
  }
  return sortWeeksDesc(collected);
}

function sortWeeksDesc(weeks: WeeklyStat[]): WeeklyStat[] {
  const deduped = new Map<number, WeeklyStat>();
  for (const week of weeks) {
    const key = week.timestamp || -deduped.size - 1; // 无时间戳的按出现顺序排后
    if (!deduped.has(key)) deduped.set(key, week);
  }
  return [...deduped.values()].sort((left, right) => right.timestamp - left.timestamp);
}

export function summarizeWeeklyStatistics(value?: string | null): WeeklyStatSummary | null {
  const weeks = parseWeeklyStatisticsSeries(value);
  if (weeks.length === 0) return null;

  const totals = {} as Record<WeeklyStatKey, number>;
  for (const key of NUMERIC_KEYS) totals[key] = 0;
  for (const week of weeks) {
    for (const key of NUMERIC_KEYS) totals[key] += week[key];
  }

  const current = weeks[0] ?? null;
  const previous = weeks.length > 1 ? weeks[1] : null;
  const featDelta = current && previous ? current.feat - previous.feat : null;
  const featDeltaRatio =
    current && previous && previous.feat !== 0 ? (current.feat - previous.feat) / previous.feat : null;
  const contriDelta = current && previous ? current.contri - previous.contri : null;

  return { weeks, current, previous, totals, featDelta, featDeltaRatio, contriDelta };
}

/** 单周指标取值（供排序） */
export function weeklyStatSortValue(summary: WeeklyStatSummary | null, key: WeeklyStatKey): number {
  if (!summary) return 0;
  return summary.current?.[key] ?? 0;
}

/**
 * 周标签：`9/14` 形式（用周起始的本地日期）。
 * 顶部一行展示多周时比 `2026-09-14` 省一半宽度，也不会像纯序号那样误导。
 */
export function formatWeekLabel(timestamp: number): string {
  if (!timestamp) return "未标周";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "未标周";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 环比文本：`+12%` / `-8%` / `新` / `—` */
export function formatWeeklyDeltaRatio(ratio: number | null): string {
  if (ratio === null) return "—";
  const percent = Math.round(ratio * 100);
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/** 本周明细的紧凑单行摘要（成员列表 hover / 单元格用） */
export function formatWeeklyStatisticsLine(summary: WeeklyStatSummary | null): string {
  if (!summary?.current) return "—";
  const current = summary.current;
  const parts = WEEKLY_STAT_COLUMNS.map((key) =>
    current[key] ? `${WEEKLY_STAT_LABELS[key]}${current[key]}` : ""
  ).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * 把多周序列压缩成"迷你柱"比例（0..1），用于表格内画趋势条。
 * 全 0 时返回等高空数组，调用方据此隐藏图表。
 */
export function weeklySparkRatios(weeks: WeeklyStat[], key: WeeklyStatKey = "feat"): number[] {
  if (weeks.length === 0) return [];
  const values = weeks.map((week) => week[key]);
  const max = Math.max(...values, 0);
  if (max <= 0) return [];
  return values.map((value) => value / max);
}
