// 周维度统计解析/建模单测。
//
// 重点覆盖两条**曾经出错**的口径：
// 1. 周次必须按 timestamp 排序，不能按 `[number]N` 序号（跨周后序号整体右移）；
// 2. 空壳周（无 timestamp 且全 0）不能参与环比，否则会把"没采到"算成-100%。

import { describe, it, expect } from "vitest";
import {
  formatWeekLabel,
  formatWeeklyDeltaRatio,
  parseWeeklyStatisticsSeries,
  summarizeWeeklyStatistics,
  weeklySeriesFromValue,
  weeklySparkRatios
} from "./weeklyStats";
import { buildAllianceDisplayMember, summarizeAllianceWeekly, weeklySortValue } from "./members";

const WEEK_A = 1789315200; // 本周
const WEEK_B = WEEK_A - 7 * 86400; // 上周
const WEEK_C = WEEK_A - 14 * 86400; // 上上周

function protocolJson(): string {
  return JSON.stringify({
    "[number]1": { timestamp: WEEK_A, feat: 300, contri: 120, seige: 90, demolish: 20, dismantle: 0, attack: 5, occupy: 1, killNum: 200, wipeOut: 0 },
    "[number]2": { timestamp: WEEK_B, feat: 200, contri: 100, seige: 60, demolish: 10, dismantle: 0, attack: 3, occupy: 0, killNum: 150, wipeOut: 0 },
    "[number]3": { timestamp: WEEK_C, feat: 100, contri: 50, seige: 30, demolish: 5, dismantle: 0, attack: 1, occupy: 0, killNum: 80, wipeOut: 0 }
  });
}

describe("parseWeeklyStatisticsSeries", () => {
  it("按 timestamp 降序排列，本周在 [0]", () => {
    const weeks = parseWeeklyStatisticsSeries(protocolJson());
    expect(weeks).toHaveLength(3);
    expect(weeks.map((week) => week.timestamp)).toEqual([WEEK_A, WEEK_B, WEEK_C]);
    expect(weeks[0].feat).toBe(300);
  });

  it("序号与时间顺序不一致时仍以时间戳为准（跨周漂移回归）", () => {
    // 模拟跨周后旧数据仍挂在 [number]1/2/3 但时间戳整体前移
    const json = JSON.stringify({
      "[number]3": { timestamp: WEEK_A, feat: 999 },
      "[number]1": { timestamp: WEEK_C, feat: 1 },
      "[number]2": { timestamp: WEEK_B, feat: 2 }
    });
    const weeks = parseWeeklyStatisticsSeries(json);
    expect(weeks[0].timestamp).toBe(WEEK_A);
    expect(weeks[0].feat).toBe(999);
  });

  it("丢弃无时间戳且全 0 的空壳周", () => {
    const json = JSON.stringify({
      "[number]1": { timestamp: WEEK_A, feat: 300 },
      "[number]2": { timestamp: 0, feat: 0, contri: 0 }
    });
    const weeks = parseWeeklyStatisticsSeries(json);
    expect(weeks).toHaveLength(1);
  });

  it("兼容扁平单周对象（早期落库/测试夹具）", () => {
    const weeks = parseWeeklyStatisticsSeries('{"attack":10,"feat":50}');
    expect(weeks).toHaveLength(1);
    expect(weeks[0].attack).toBe(10);
    expect(weeks[0].feat).toBe(50);
  });

  it("兼容数组形态", () => {
    const weeks = weeklySeriesFromValue([
      { timestamp: WEEK_B, feat: 5 },
      { timestamp: WEEK_A, feat: 9 }
    ]);
    expect(weeks.map((week) => week.timestamp)).toEqual([WEEK_A, WEEK_B]);
  });

  it("非法输入不抛异常，返回空数组", () => {
    expect(parseWeeklyStatisticsSeries(undefined)).toEqual([]);
    expect(parseWeeklyStatisticsSeries("")).toEqual([]);
    expect(parseWeeklyStatisticsSeries("{不是 json")).toEqual([]);
    expect(parseWeeklyStatisticsSeries("{}")).toEqual([]);
  });

  it("字符串数字也能解析（协议里偶发）", () => {
    const weeks = parseWeeklyStatisticsSeries(JSON.stringify({ "[number]1": { timestamp: WEEK_A, feat: "123" } }));
    expect(weeks[0].feat).toBe(123);
  });
});

describe("summarizeWeeklyStatistics", () => {
  it("给出本周/上周、环比与合计", () => {
    const summary = summarizeWeeklyStatistics(protocolJson());
    expect(summary).not.toBeNull();
    expect(summary!.current!.feat).toBe(300);
    expect(summary!.previous!.feat).toBe(200);
    expect(summary!.featDelta).toBe(100);
    expect(summary!.featDeltaRatio).toBeCloseTo(0.5);
    expect(summary!.totals.feat).toBe(600);
    expect(summary!.totals.contri).toBe(270);
  });

  it("上周战功为 0 时环比为 null（不做除零，也不谎报 100%）", () => {
    const json = JSON.stringify({
      "[number]1": { timestamp: WEEK_A, feat: 300 },
      "[number]2": { timestamp: WEEK_B, feat: 0, killNum: 5 }
    });
    const summary = summarizeWeeklyStatistics(json);
    expect(summary!.featDelta).toBe(300);
    expect(summary!.featDeltaRatio).toBeNull();
  });

  it("只有一周时 delta/ratio 为 null", () => {
    const summary = summarizeWeeklyStatistics(JSON.stringify({ "[number]1": { timestamp: WEEK_A, feat: 300 } }));
    expect(summary!.previous).toBeNull();
    expect(summary!.featDelta).toBeNull();
    expect(summary!.featDeltaRatio).toBeNull();
  });

  it("无数据返回 null", () => {
    expect(summarizeWeeklyStatistics("{}")).toBeNull();
    expect(summarizeWeeklyStatistics(null)).toBeNull();
  });
});

describe("weeklySparkRatios / 展示格式", () => {
  it("按最大值归一；全 0 返回空数组", () => {
    const weeks = parseWeeklyStatisticsSeries(protocolJson());
    expect(weeklySparkRatios(weeks)).toEqual([1, 200 / 300, 100 / 300]);
    expect(weeklySparkRatios([{ ...weeks[0], feat: 0 }])).toEqual([]);
  });

  it("周标签用月/日", () => {
    expect(formatWeekLabel(0)).toBe("未标周");
    expect(formatWeekLabel(WEEK_A)).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });

  it("环比文本带符号", () => {
    expect(formatWeeklyDeltaRatio(null)).toBe("—");
    expect(formatWeeklyDeltaRatio(0)).toBe("0%");
    expect(formatWeeklyDeltaRatio(0.5)).toBe("+50%");
    expect(formatWeeklyDeltaRatio(-0.128)).toBe("-13%");
  });
});

describe("成员模型与同盟汇总", () => {
  it("buildAllianceDisplayMember 解析出 weeklySummary", () => {
    const member = buildAllianceDisplayMember({ name: "甲", weeklyStatisticsJson: protocolJson() });
    expect(member.weeklySummary?.current?.feat).toBe(300);
    expect(weeklySortValue(member, "feat")).toBe(300);
    expect(weeklySortValue(member, "featDeltaRatio")).toBeCloseTo(0.5);
  });

  it("无周数据时 weeklySummary 为 null，排序取值取 0/-Infinity", () => {
    const member = buildAllianceDisplayMember({ name: "乙" });
    expect(member.weeklySummary).toBeNull();
    expect(weeklySortValue(member, "feat")).toBe(0);
    expect(weeklySortValue(member, "featDeltaRatio")).toBe(-Infinity);
  });

  it("同盟汇总只统计有周数据的成员，并给出环比中位数", () => {
    const members = [
      buildAllianceDisplayMember({ name: "甲", weeklyStatisticsJson: protocolJson() }),
      buildAllianceDisplayMember({
        name: "乙",
        weeklyStatisticsJson: JSON.stringify({
          "[number]1": { timestamp: WEEK_A, feat: 50 },
          "[number]2": { timestamp: WEEK_B, feat: 100 }
        })
      }),
      // 无周数据：必须完全不参与合计
      buildAllianceDisplayMember({ name: "丙", tFeat: 9999 })
    ];
    const totals = summarizeAllianceWeekly(members);
    expect(totals.coveredMembers).toBe(2);
    expect(totals.feat).toBe(350);
    expect(totals.contri).toBe(120);
    expect(totals.comparableMembers).toBe(2);
    // 0.5 与 -0.5 的中位数
    expect(totals.featDeltaRatioMedian).toBeCloseTo(0);
  });

  it("没有任何周数据时中位数为 null", () => {
    const totals = summarizeAllianceWeekly([buildAllianceDisplayMember({ name: "丁" })]);
    expect(totals.coveredMembers).toBe(0);
    expect(totals.featDeltaRatioMedian).toBeNull();
  });
});
