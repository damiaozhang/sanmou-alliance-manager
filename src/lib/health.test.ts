import { describe, expect, it } from "vitest";
import type { CaptureSessionRow, LineupStatRow, MemberSnapshotRow } from "../tauri";
import { computeHealth, groupSnapshotsByTime, healthTone, onlineRate } from "./health";

function stat(partial: Partial<LineupStatRow>): LineupStatRow {
  return {
    id: 1,
    workspaceId: 1,
    avatarId: "av-1",
    playerName: "",
    allianceName: "",
    lineupKey: "k",
    label: "",
    formationId: "",
    formationName: "",
    heroIdsJson: "[]",
    heroLevelsJson: "[]",
    avgEvolution: 0,
    battles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    attackBattles: 0,
    defendBattles: 0,
    totalMerit: 0,
    totalOriginTroops: 0,
    totalRemainingTroops: 0,
    totalWounded: 0,
    totalDead: 0,
    totalEnemyOriginTroops: 0,
    totalEnemyRemainingTroops: 0,
    totalEnemyWounded: 0,
    totalEnemyDead: 0,
    lossExchangeRatio: 0,
    lastBattleTime: "",
    notes: null,
    observedAt: "",
    ...partial,
  };
}

function snapshot(partial: Partial<MemberSnapshotRow>): MemberSnapshotRow {
  return {
    id: 1,
    captureSessionId: 1,
    observedAt: "2026-01-01 00:00:00",
    avatarId: "av-1",
    avatarName: "玩家",
    officialName: "",
    professionName: "",
    professionId: 0,
    state: null,
    isOnline: 1,
    roleId: 0,
    legionName: "",
    legionId: 0,
    legionLeader: 0,
    prosperity: 0,
    weeklyContribution: 0,
    weeklyMerit: 0,
    seasonScore: 0,
    demolitionValue: 0,
    coordinateX: 0,
    coordinateY: 0,
    lastOfflineTs: 0,
    joinTs: 0,
    tFeat: 0,
    tForageUse: 0,
    wForageUse: 0,
    weeklyStatisticsJson: "{}",
    rawJson: "{}",
    ...partial,
  };
}

function session(startedAt: string): CaptureSessionRow {
  return {
    id: 1,
    captureType: "battle_report",
    status: "completed",
    startedAt,
    finishedAt: startedAt,
    summaryJson: "{}",
  };
}

describe("groupSnapshotsByTime", () => {
  it("按 observedAt 分组", () => {
    const groups = groupSnapshotsByTime([
      snapshot({ observedAt: "2026-01-01" }),
      snapshot({ observedAt: "2026-01-02", avatarId: "av-2" }),
      snapshot({ observedAt: "2026-01-01", avatarId: "av-3" }),
    ]);
    expect(groups.get("2026-01-01")?.length).toBe(2);
    expect(groups.get("2026-01-02")?.length).toBe(1);
  });
});

describe("onlineRate", () => {
  it("计算在线比例", () => {
    expect(onlineRate([
      snapshot({ isOnline: 1 }),
      snapshot({ isOnline: 0 }),
      snapshot({ isOnline: 1 }),
    ])).toBeCloseTo(2 / 3);
  });
  it("空组返回 0", () => {
    expect(onlineRate([])).toBe(0);
  });
});

describe("computeHealth (S5)", () => {
  it("无数据时返回中性分", () => {
    const r = computeHealth([], [], []);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.facets.onlineTrend).toBe(50);
    expect(r.facets.redSpread).toBe(50);
  });

  it("两次快照在线率上升 → onlineTrend 高", () => {
    const r = computeHealth(
      [
        snapshot({ observedAt: "2026-01-01", isOnline: 0 }),
        snapshot({ observedAt: "2026-01-02", isOnline: 1 }),
      ],
      [],
      []
    );
    // 0.5 + (1 - 0) = 1.5 → clamp 1 → 100
    expect(r.facets.onlineTrend).toBe(100);
    expect(r.notes.onlineTrend).toContain("0% → 100%");
  });

  it("平均红度加权计入 redSpread", () => {
    const r = computeHealth([], [
      stat({ battles: 10, avgEvolution: 6 }),
      stat({ battles: 10, avgEvolution: 0 }),
    ], []);
    // 加权平均 3 / 6 = 0.5 → 50
    expect(r.facets.redSpread).toBe(50);
  });

  it("成员数稳定 → attritionSlope 高", () => {
    const r = computeHealth(
      [
        snapshot({ observedAt: "2026-01-01", avatarId: "a" }),
        snapshot({ observedAt: "2026-01-01", avatarId: "b" }),
        snapshot({ observedAt: "2026-01-02", avatarId: "a" }),
        snapshot({ observedAt: "2026-01-02", avatarId: "b" }),
      ],
      [],
      []
    );
    expect(r.facets.attritionSlope).toBe(100);
  });

  it("近 14 天 3 次采集 → joinLeaveRate 满分", () => {
    const now = new Date().toISOString();
    const r = computeHealth([], [], [
      session(now),
      session(now),
      session(now),
    ]);
    expect(r.facets.joinLeaveRate).toBe(100);
  });
});

describe("healthTone", () => {
  it("分数段映射语义", () => {
    expect(healthTone(80).label).toBe("健康");
    expect(healthTone(80).tone).toBe("success");
    expect(healthTone(60).label).toBe("稳定");
    expect(healthTone(60).tone).toBe("info");
    expect(healthTone(40).label).toBe("预警");
    expect(healthTone(40).tone).toBe("warning");
    expect(healthTone(20).label).toBe("告急");
    expect(healthTone(20).tone).toBe("destructive");
  });
});
