import { describe, expect, it } from "vitest";
import type { LineupMatchupRow } from "../tauri";
import { localDateKey } from "./dates";
import { attackerOutcomeFromResult } from "./labels";
import {
  buildCounterRecommendations,
  buildCounterRecommendationsV2,
  buildWinRateMatrix,
  MIN_COUNTER_SAMPLE,
  wilsonLowerBound,
  timeDecayWeight,
  summarizeWinRate,
  aggregateDailyWinRate,
  type WinRateOutcome,
} from "./winrate";

function matchup(partial: Partial<LineupMatchupRow>): LineupMatchupRow {
  return {
    id: 1,
    workspaceId: 1,
    attackerAvatarId: "att-1",
    attackerPlayerName: "攻方玩家",
    attackerLineupKey: "A",
    attackerLineupLabel: "阵容A",
    defenderAvatarId: "def-1",
    defenderPlayerName: "守方玩家",
    defenderLineupKey: "D",
    defenderLineupLabel: "阵容D",
    outcome: "win",
    battleTime: "2026-01-01 10:00:00",
    battleCode: "code-1",
    observedAt: "2026-01-01 10:00:00",
    matchType: 0,
    combatType: 0,
    scenarioId: 0,
    endRound: 0,
    location: "",
    ...partial,
  };
}

describe("buildWinRateMatrix", () => {
  it("空输入返回空矩阵", () => {
    const matrix = buildWinRateMatrix([]);
    expect(matrix.attackerKeys).toEqual([]);
    expect(matrix.defenderKeys).toEqual([]);
    expect(matrix.cells).toEqual({});
    expect(matrix.labels).toEqual({});
  });

  it("聚合同一攻击/防守组合的胜负平场次", () => {
    const matrix = buildWinRateMatrix([
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "win", battleCode: "c2" }),
      matchup({ outcome: "loss", battleCode: "c3" }),
      matchup({ outcome: "draw", battleCode: "c4" }),
    ]);
    expect(matrix.attackerKeys).toEqual(["A"]);
    expect(matrix.defenderKeys).toEqual(["D"]);
    const cell = matrix.cells["A"]["D"];
    expect(cell.wins).toBe(2);
    expect(cell.losses).toBe(1);
    expect(cell.draws).toBe(1);
    expect(cell.battles).toBe(4);
    expect(cell.winRate).toBeCloseTo(0.625);
  });

  it("平局计半胜：胜率按 (wins + draws*0.5)/battles 计算", () => {
    const matrix = buildWinRateMatrix([
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "draw", battleCode: "c2" }),
      matchup({ outcome: "draw", battleCode: "c3" }),
    ]);
    const cell = matrix.cells["A"]["D"];
    expect(cell.draws).toBe(2);
    expect(cell.winRate).toBeCloseTo(2 / 3);
  });

  it("跳过缺少阵容 key 的记录", () => {
    const matrix = buildWinRateMatrix([
      matchup({ attackerLineupKey: "", battleCode: "c1" }),
      matchup({ defenderLineupKey: "", battleCode: "c2" }),
    ]);
    expect(matrix.attackerKeys).toEqual([]);
    expect(matrix.defenderKeys).toEqual([]);
  });

  it("unknown 不计入分母，不稀释胜率", () => {
    const matrix = buildWinRateMatrix([
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "unknown", battleCode: "c2" }),
      matchup({ outcome: "unknown", battleCode: "c3" }),
    ]);
    const cell = matrix.cells["A"]["D"];
    expect(cell.battles).toBe(1);
    expect(cell.wins).toBe(1);
    expect(cell.winRate).toBeCloseTo(1);
    // 行列总场次同样排除 unknown
    expect(matrix.attackerKeys).toEqual(["A"]);
  });

  it("全部为 unknown 时单元格场次为 0，不计入任何胜负", () => {
    const matrix = buildWinRateMatrix([
      matchup({ outcome: "unknown", battleCode: "c1" }),
    ]);
    const cell = matrix.cells["A"]?.["D"];
    expect(cell?.battles ?? 0).toBe(0);
    expect(cell?.wins ?? 0).toBe(0);
    expect(cell?.winRate ?? 0).toBe(0);
  });

  it("行与列按总场次降序排列", () => {
    const rows = [
      matchup({ attackerLineupKey: "A1", attackerLineupLabel: "甲", battleCode: "c1" }),
      matchup({ attackerLineupKey: "A2", attackerLineupLabel: "乙", battleCode: "c2" }),
      matchup({ attackerLineupKey: "A2", attackerLineupLabel: "乙", battleCode: "c3" }),
    ];
    const matrix = buildWinRateMatrix(rows);
    expect(matrix.attackerKeys).toEqual(["A2", "A1"]);
    expect(matrix.labels["A2"]).toBe("乙");
  });
});

describe("buildCounterRecommendations", () => {
  it("空矩阵返回空推荐", () => {
    expect(buildCounterRecommendations(buildWinRateMatrix([]))).toEqual([]);
  });

  it("对每个防守方阵容按胜率推荐攻击方 Top 3", () => {
    const rows: LineupMatchupRow[] = [];
    // 阵容A 对 D：4 胜 1 负（80%）
    for (let i = 0; i < 4; i++) rows.push(matchup({ outcome: "win", battleCode: `a-w-${i}` }));
    rows.push(matchup({ outcome: "loss", battleCode: "a-l-0" }));
    // 阵容B 对 D：3 胜 2 负（60%）
    for (let i = 0; i < 3; i++) {
      rows.push(matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "win", battleCode: `b-w-${i}` }));
    }
    for (let i = 0; i < 2; i++) {
      rows.push(matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "loss", battleCode: `b-l-${i}` }));
    }
    // 阵容C 对 D：1 胜 1 负（50%）
    rows.push(matchup({ attackerLineupKey: "C", attackerLineupLabel: "阵容C", outcome: "win", battleCode: "c-w-0" }));
    rows.push(matchup({ attackerLineupKey: "C", attackerLineupLabel: "阵容C", outcome: "loss", battleCode: "c-l-0" }));

    const matrix = buildWinRateMatrix(rows);
    const recs = buildCounterRecommendations(matrix);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    expect(rec.defenderKey).toBe("D");
    expect(rec.totalBattles).toBe(12);
    expect(rec.sufficient).toBe(true);
    expect(rec.picks.map((p) => p.attackerKey)).toEqual(["A", "B", "C"]);
    expect(rec.picks[0].winRate).toBeCloseTo(0.8);
    expect(rec.picks[1].winRate).toBeCloseTo(0.6);
  });

  it("防守方总场次不足 minBattles 时标记样本不足", () => {
    const rows = [
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "win", battleCode: "c2" }),
    ];
    const recs = buildCounterRecommendations(buildWinRateMatrix(rows));
    expect(recs).toHaveLength(1);
    expect(recs[0].totalBattles).toBe(2);
    expect(recs[0].sufficient).toBe(false);
    expect(recs[0].picks).toEqual([]);
  });

  it("总场次恰好等于 minBattles 时参与推荐", () => {
    const rows = [
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "loss", battleCode: "c2" }),
      matchup({ outcome: "draw", battleCode: "c3" }),
    ];
    const recs = buildCounterRecommendations(buildWinRateMatrix(rows));
    expect(MIN_COUNTER_SAMPLE).toBe(3);
    expect(recs[0].sufficient).toBe(true);
    expect(recs[0].picks).toHaveLength(1);
    expect(recs[0].picks[0].winRate).toBeCloseTo(0.5);
  });

  it("支持自定义 minBattles 与 topN", () => {
    const rows = [
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "win", battleCode: "c2" }),
    ];
    const recs = buildCounterRecommendations(buildWinRateMatrix(rows), 2, 1);
    expect(recs[0].sufficient).toBe(true);
    expect(recs[0].picks).toHaveLength(1);
  });
});

describe("wilsonLowerBound", () => {
  it("n=0 返回 0", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("全胜小样本下界显著低于 100%（惩罚过拟合）", () => {
    // 3 场全胜：点估计 100%，Wilson 下界约 0.42
    const lb = wilsonLowerBound(3, 3);
    expect(lb).toBeGreaterThan(0.3);
    expect(lb).toBeLessThan(0.6);
  });

  it("大样本全胜下界接近 1", () => {
    const lb = wilsonLowerBound(50, 50);
    expect(lb).toBeGreaterThan(0.9);
  });
});

describe("timeDecayWeight", () => {
  const now = new Date("2026-08-01T00:00:00").getTime();

  it("今天权重为 1", () => {
    expect(timeDecayWeight("2026-08-01 10:00:00", now)).toBeCloseTo(1, 2);
  });

  it("30 天前权重 ≈ e^-1 ≈ 0.37", () => {
    const w = timeDecayWeight("2026-07-02 00:00:00", now);
    expect(w).toBeGreaterThan(0.3);
    expect(w).toBeLessThan(0.45);
  });
});

describe("buildCounterRecommendationsV2", () => {
  it("空输入返回空推荐", () => {
    expect(buildCounterRecommendationsV2([])).toEqual([]);
  });

  it("小样本高胜率被 Wilson 惩罚：3 场 100% 不敌 12 场 80%", () => {
    const rows: LineupMatchupRow[] = [];
    // 阵容A（小样本 100%）：3 胜 0 负
    for (let i = 0; i < 3; i++) rows.push(matchup({ outcome: "win", battleCode: `a-w-${i}` }));
    // 阵容B（大样本 80%）：8 胜 2 负
    for (let i = 0; i < 8; i++) {
      rows.push(matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "win", battleCode: `b-w-${i}` }));
    }
    for (let i = 0; i < 2; i++) {
      rows.push(matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "loss", battleCode: `b-l-${i}` }));
    }

    const recs = buildCounterRecommendationsV2(rows);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    expect(rec.sufficient).toBe(true);
    expect(rec.picks[0].attackerKey).toBe("B");
    expect(rec.picks[0].reason).toContain("8 胜");
  });

  it("红度差加分：+1 红的小样本队超过无红差大样本队", () => {
    const rows: LineupMatchupRow[] = [];
    for (let i = 0; i < 4; i++) rows.push(matchup({ outcome: "win", battleCode: `a-w-${i}` }));
    for (let i = 0; i < 5; i++) rows.push(matchup({ outcome: "loss", battleCode: `a-l-${i}` }));
    for (let i = 0; i < 10; i++) {
      rows.push(matchup({ attackerLineupKey: "B", attackerLineupLabel: "阵容B", outcome: "win", battleCode: `b-w-${i}` }));
    }

    // 无红差：B（10 胜）应排第一
    const recs0 = buildCounterRecommendationsV2(rows);
    expect(recs0[0].picks[0].attackerKey).toBe("B");
    // 攻击方 A 红度优势 +3：A 的 score 抬高
    const recs1 = buildCounterRecommendationsV2(rows, { redDiff: 3 });
    const pickA = recs1[0].picks.find((p) => p.attackerKey === "A");
    expect(pickA).toBeDefined();
    expect(pickA!.reason).toContain("红度优势");
  });

  it("防守方总场次不足 3 时标记样本不足", () => {
    const rows = [
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "win", battleCode: "c2" }),
    ];
    const recs = buildCounterRecommendationsV2(rows);
    expect(recs[0].sufficient).toBe(false);
    expect(recs[0].picks).toEqual([]);
  });

  it("unknown 不计入分母：2 胜 + 3 unknown 视为 2 场 100%（样本不足）", () => {
    const rows = [
      matchup({ outcome: "win", battleCode: "c1" }),
      matchup({ outcome: "win", battleCode: "c2" }),
      matchup({ outcome: "unknown", battleCode: "c3" }),
      matchup({ outcome: "unknown", battleCode: "c4" }),
      matchup({ outcome: "unknown", battleCode: "c5" }),
    ];
    const recs = buildCounterRecommendationsV2(rows);
    // 仅 2 场已知 < MIN_COUNTER_SAMPLE → 样本不足，unknown 未虚增场次
    expect(recs[0].totalBattles).toBe(2);
    expect(recs[0].sufficient).toBe(false);
  });
});

describe("summarizeWinRate（统一口径）", () => {
  it("平局计半胜：1 胜 2 平 1 负 → 0.5", () => {
    const s = summarizeWinRate(["win", "draw", "draw", "loss"] as WinRateOutcome[]);
    expect(s.total).toBe(4);
    expect(s.wins).toBe(1);
    expect(s.winRate).toBeCloseTo(0.5);
  });

  it("unknown 不计入分母，不稀释胜率", () => {
    const s = summarizeWinRate(["win", "unknown", "unknown"] as WinRateOutcome[]);
    expect(s.total).toBe(1);
    expect(s.winRate).toBe(1);
  });

  it("无已知场次（全 unknown / 空）返回 0，不 NaN", () => {
    expect(summarizeWinRate(["unknown"] as WinRateOutcome[]).winRate).toBe(0);
    expect(summarizeWinRate([]).winRate).toBe(0);
  });
});

describe("aggregateDailyWinRate（统一口径 + 本地日期桶）", () => {
  it("用本地日期桶聚合，UTC 偏移不会错算到另一天；守方胜算我方负", () => {
    const today = new Date();
    const t = new Date(today);
    t.setHours(2, 0, 0, 0); // 本地凌晨 2 点；若所在时区为 UTC+8，则 UTC 为前一天，正好暴露 toISOString 的 UTC bug
    const timeStr = `${localDateKey(t)} 02:00:00`;
    const battles = [
      { time: timeStr, result: "攻方胜" },
      { time: timeStr, result: "守方胜" },
    ];
    const { daily, overall } = aggregateDailyWinRate(
      battles,
      (b) => localDateKey(new Date(b.time)),
      (b) => attackerOutcomeFromResult(b.result) as WinRateOutcome,
      1,
    );
    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe(localDateKey(t));
    expect(daily[0].wins).toBe(1);
    expect(daily[0].losses).toBe(1);
    expect(daily[0].total).toBe(2);
    expect(overall.winRate).toBeCloseTo(0.5);
  });

  it("unknown 的当日不计入分母", () => {
    const today = localDateKey(new Date());
    const battles = [
      { time: `${today} 12:00:00`, result: "攻方胜" },
      { time: `${today} 13:00:00`, result: "交战" },
    ];
    const { daily } = aggregateDailyWinRate(
      battles,
      (b) => localDateKey(new Date(b.time)),
      (b) => attackerOutcomeFromResult(b.result) as WinRateOutcome,
      1,
    );
    expect(daily[0].total).toBe(1);
    expect(daily[0].winRate).toBe(1);
  });
});

