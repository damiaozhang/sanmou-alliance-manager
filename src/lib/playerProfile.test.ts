import { describe, expect, it } from "vitest";
import type { LineupMatchupRow, LineupStatRow } from "../tauri";
import { buildLineupChangeTimeline, lineupWinRate, pickMainLineups } from "./playerProfile";

function stat(partial: Partial<LineupStatRow>): LineupStatRow {
  return {
    id: 1,
    workspaceId: 1,
    avatarId: "av-1",
    playerName: "玩家",
    allianceName: "同盟",
    lineupKey: "k",
    label: "阵容",
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

function matchup(partial: Partial<LineupMatchupRow>): LineupMatchupRow {
  return {
    id: 1,
    workspaceId: 1,
    attackerAvatarId: "atk",
    attackerPlayerName: "攻",
    attackerLineupKey: "A",
    attackerLineupLabel: "阵容A",
    defenderAvatarId: "def",
    defenderPlayerName: "守",
    defenderLineupKey: "D",
    defenderLineupLabel: "阵容D",
    outcome: "win",
    battleTime: "2026-01-01 10:00:00",
    battleCode: "c1",
    observedAt: "2026-01-01 10:00:00",
    matchType: 0,
    combatType: 0,
    scenarioId: 0,
    endRound: 0,
    location: "",
    ...partial,
  };
}

describe("pickMainLineups (S2 主队识别)", () => {
  it("空输入返回 null 主队", () => {
    expect(pickMainLineups([]).main).toBeNull();
  });

  it("场次最多的为主队", () => {
    const { main, alternates } = pickMainLineups([
      stat({ lineupKey: "k1", label: "阵容1", battles: 10 }),
      stat({ lineupKey: "k2", label: "阵容2", battles: 4 }),
      stat({ lineupKey: "k3", label: "阵容3", battles: 1 }),
    ]);
    expect(main?.lineupKey).toBe("k1");
    // 副队场次 ≥ 主队 30%（3 场），k2 符合、k3 不符合
    expect(alternates.map((s) => s.lineupKey)).toEqual(["k2"]);
  });

  it("同场次时取列表在前者", () => {
    const { main } = pickMainLineups([
      stat({ lineupKey: "first", battles: 5 }),
      stat({ lineupKey: "second", battles: 5 }),
    ]);
    expect(main?.lineupKey).toBe("first");
  });
});

describe("lineupWinRate (S2 主队胜率)", () => {
  it("平局计半胜", () => {
    expect(lineupWinRate(stat({ battles: 4, wins: 2, losses: 1, draws: 1 }))).toBeCloseTo(0.625);
  });
  it("无数据返回 0", () => {
    expect(lineupWinRate(null)).toBe(0);
    expect(lineupWinRate(stat({ battles: 0 }))).toBe(0);
  });
});

describe("buildLineupChangeTimeline (S2 换阵时间线)", () => {
  it("空输入无换阵", () => {
    expect(buildLineupChangeTimeline([], "av-1")).toEqual([]);
  });

  it("相同阵容连续出场不记换阵", () => {
    const changes = buildLineupChangeTimeline(
      [
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "A", battleTime: "2026-01-01" }),
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "A", battleTime: "2026-01-02" }),
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "A", battleTime: "2026-01-03" }),
      ],
      "p1"
    );
    expect(changes).toEqual([]);
  });

  it("换阵时记录 旧→新", () => {
    const changes = buildLineupChangeTimeline(
      [
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "A", attackerLineupLabel: "阵容A", battleTime: "2026-01-01" }),
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "B", attackerLineupLabel: "阵容B", battleTime: "2026-01-02" }),
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "B", attackerLineupLabel: "阵容B", battleTime: "2026-01-03" }),
        matchup({ attackerAvatarId: "p1", attackerLineupKey: "C", attackerLineupLabel: "阵容C", battleTime: "2026-01-04" }),
      ],
      "p1"
    );
    expect(changes).toEqual([
      { time: "2026-01-02", from: "阵容A", to: "阵容B" },
      { time: "2026-01-04", from: "阵容B", to: "阵容C" },
    ]);
  });

  it("防守侧也计入该玩家阵容切换", () => {
    const changes = buildLineupChangeTimeline(
      [
        matchup({ defenderAvatarId: "p1", defenderLineupKey: "X", defenderLineupLabel: "阵容X", battleTime: "2026-01-01" }),
        matchup({ defenderAvatarId: "p1", defenderLineupKey: "Y", defenderLineupLabel: "阵容Y", battleTime: "2026-01-02" }),
      ],
      "p1"
    );
    expect(changes).toEqual([{ time: "2026-01-02", from: "阵容X", to: "阵容Y" }]);
  });
});
