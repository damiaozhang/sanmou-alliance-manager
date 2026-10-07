import { describe, expect, it, vi } from "vitest";
import type { JsonRecord } from "../types";
import { renderHook, waitFor } from "@testing-library/react";
import { buildLineupMatchupInputs, buildLineupStatRequests, buildLineupSyncKey, aggregatePlayerLineupStats, useLineupSync, type PlayerLineupAcc } from "./useLineupSync";

// 并发守卫（P1-2）依赖 @/app/mutations 的三个批量写 mutation；用稳定的 mock 对象
// 记录调用次数，验证「同步进行中 records 变化」会被 pending 重触发而非永久丢弃。
const lineSyncMocks = vi.hoisted(() => ({
  statsMut: { mutateAsync: vi.fn((_req: unknown) => new Promise((res) => setTimeout(() => res(1), 10))) },
  matchupsMut: { mutateAsync: vi.fn((_req: unknown) => new Promise((res) => setTimeout(() => res(1), 10))) },
  bindingsMut: { mutateAsync: vi.fn((_req: unknown) => new Promise((res) => setTimeout(() => res(1), 10))) },
}));

vi.mock("@/app/mutations", () => ({
  useSyncLineupStatsMutation: () => lineSyncMocks.statsMut,
  useSyncLineupMatchupsMutation: () => lineSyncMocks.matchupsMut,
  useSyncMemberBindingsMutation: () => lineSyncMocks.bindingsMut,
}));

function hero(id: string, level = 50): JsonRecord {
  return { heroId: id, level, originTroops: 5000 };
}

function battleRecord(partial: Partial<JsonRecord>): JsonRecord {
  return {
    winnerSide: "attacker_win",
    battleTime: "2026-01-05 12:00:00",
    battleCode: "BC-001",
    attacker: {
      player: { name: "玩家甲", avatarId: "av-1", allianceName: "同盟甲" },
      formationId: "1",
      heroes: [hero("101"), hero("102"), hero("103")],
      totals: { armyTroops: 15000 },
    },
    defender: {
      player: { name: "玩家乙", avatarId: "av-2", allianceName: "同盟乙" },
      formationId: "2",
      heroes: [hero("201"), hero("202"), hero("203")],
      totals: { armyTroops: 15000 },
    },
    ...partial,
  };
}

function emptyAcc(partial: Partial<PlayerLineupAcc>): PlayerLineupAcc {
  return {
    avatarId: "av-1",
    playerName: "玩家甲",
    allianceName: "同盟甲",
    lineupKey: "formation:1|ids:101/102/103",
    label: "鱼鳞阵 · 甲队",
    formationId: "1",
    formationName: "鱼鳞阵",
    heroIds: ["101", "102", "103"],
    battles: 2,
    wins: 1,
    losses: 1,
    draws: 0,
    attackBattles: 2,
    defendBattles: 0,
    totalMerit: 500,
    totalOriginTroops: 2000,
    totalRemainingTroops: 1000,
    totalWounded: 200,
    totalDead: 100,
    totalEnemyOriginTroops: 2000,
    totalEnemyRemainingTroops: 800,
    totalEnemyWounded: 400,
    totalEnemyDead: 200,
    totalEvolution: 6,
    evolutionCount: 3,
    lastBattleTime: "2026-01-05 12:00:00",
    ...partial,
  };
}

describe("buildLineupSyncKey", () => {
  it("changes when a middle record changes", () => {
    const base = [battleRecord({}), battleRecord({ battleCode: "BC-2" }), battleRecord({ battleCode: "BC-3" })];
    const changed = [battleRecord({}), battleRecord({ battleCode: "BC-2-x" }), battleRecord({ battleCode: "BC-3" })];
    expect(buildLineupSyncKey(base, 1, null)).not.toBe(buildLineupSyncKey(changed, 1, null));
  });

  it("is stable for identical records and scopes workspace/alliance", () => {
    const recs = [battleRecord({}), battleRecord({ battleCode: "BC-2" })];
    expect(buildLineupSyncKey(recs, 1, null)).toBe(buildLineupSyncKey(recs, 1, null));
    expect(buildLineupSyncKey(recs, 1, 2)).not.toBe(buildLineupSyncKey(recs, 1, null));
    expect(buildLineupSyncKey(recs, 2, null)).not.toBe(buildLineupSyncKey(recs, 1, null));
  });
});

describe("buildLineupMatchupInputs", () => {
  it("空输入返回空数组", () => {
    expect(buildLineupMatchupInputs([], 1)).toEqual([]);
  });

  it("按每场战报生成一行对阵，攻方视角 outcome", () => {
    const rows = buildLineupMatchupInputs([battleRecord({})], 7);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.workspaceId).toBe(7);
    expect(row.attackerPlayerName).toBe("玩家甲");
    expect(row.attackerAvatarId).toBe("av-1");
    expect(row.defenderPlayerName).toBe("玩家乙");
    expect(row.defenderAvatarId).toBe("av-2");
    expect(row.attackerLineupKey).toContain("formation:1");
    expect(row.defenderLineupKey).toContain("formation:2");
    expect(row.outcome).toBe("win");
    expect(row.battleTime).toBe("2026-01-05 12:00:00");
    expect(row.battleCode).toBe("BC-001");
  });

  it("S3: 提取 combatType/scenarioId/endRound/location 分类字段", () => {
    const rows = buildLineupMatchupInputs([
      battleRecord({
        combatType: 7,
        scenarioId: 33,
        endRound: 6,
        location: [312, 418],
      }),
    ], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].combatType).toBe(7);
    expect(rows[0].scenarioId).toBe(33);
    expect(rows[0].endRound).toBe(6);
    expect(rows[0].location).toBe("312,418");
    expect(rows[0].matchType).toBe(0); // matchType 由分类器消费侧回填，入库层保持 0
  });

  it("S3: location 为字符串坐标时原样透传，缺失时为空串", () => {
    const strRows = buildLineupMatchupInputs([
      battleRecord({ location: "88,99" }),
    ], 1);
    expect(strRows[0].location).toBe("88,99");
    const emptyRows = buildLineupMatchupInputs([battleRecord({})], 1);
    expect(emptyRows[0].location).toBe("");
  });

  it("攻方负与平局正确映射", () => {
    const loss = buildLineupMatchupInputs([battleRecord({ winnerSide: "defender_win" })], 1);
    expect(loss[0].outcome).toBe("loss");
    const draw = buildLineupMatchupInputs([battleRecord({ winnerSide: "draw" })], 1);
    expect(draw[0].outcome).toBe("draw");
  });

  it("任一侧阵容信息缺失则跳过该条", () => {
    const noDefender = buildLineupMatchupInputs([battleRecord({ defender: undefined })], 1);
    expect(noDefender).toEqual([]);
    const noHeroes = buildLineupMatchupInputs([
      battleRecord({ defender: { player: { name: "玩家乙" }, formationId: "2", heroes: [] } }),
    ], 1);
    expect(noHeroes).toEqual([]);
  });

  it("缺少 battleCode 字段时退化为 record key", () => {
    const record = battleRecord({});
    delete record["battleCode"];
    const rows = buildLineupMatchupInputs([record], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].battleCode).not.toBe("");
    expect(rows[0].battleCode).not.toBe("BC-001");
  });

  it("终审口径过滤：child 残队（少于 3 将）不入库", () => {
    const rows = buildLineupMatchupInputs([
      battleRecord({
        recordType: "child",
        defender: {
          player: { name: "玩家乙", avatarId: "av-2", allianceName: "同盟乙" },
          formationId: "2",
          heroes: [hero("201"), hero("202")], // 残队：只剩 2 将
          totals: { armyTroops: 9000 },
        },
      }),
    ], 1);
    expect(rows).toEqual([]);
  });

  it("终审口径过滤：假兵力（armyTroops ≤ 100，实为武将数）不入库", () => {
    const rows = buildLineupMatchupInputs([
      battleRecord({
        recordType: "child",
        attacker: {
          player: { name: "玩家甲", avatarId: "av-1", allianceName: "同盟甲" },
          formationId: "1",
          heroes: [hero("101"), hero("102"), hero("103")],
          totals: { armyTroops: 3 }, // 假兵力：实际是武将数
        },
      }),
    ], 1);
    expect(rows).toEqual([]);
  });

  it("终审口径过滤：兵力不足 5000 或武将等级不足 46 不入库", () => {
    const lowTroops = buildLineupMatchupInputs([
      battleRecord({
        attacker: {
          player: { name: "玩家甲", avatarId: "av-1", allianceName: "同盟甲" },
          formationId: "1",
          heroes: [hero("101"), hero("102"), hero("103")],
          totals: { armyTroops: 4999 },
        },
      }),
    ], 1);
    expect(lowTroops).toEqual([]);

    const lowLevel = buildLineupMatchupInputs([
      battleRecord({
        defender: {
          player: { name: "玩家乙", avatarId: "av-2", allianceName: "同盟乙" },
          formationId: "2",
          heroes: [hero("201"), hero("202"), hero("203", 45)],
          totals: { armyTroops: 15000 },
        },
      }),
    ], 1);
    expect(lowLevel).toEqual([]);
  });
});

describe("buildLineupStatRequests", () => {
  it("把聚合统计映射为批量请求并计算战损交换比", () => {
    const requests = buildLineupStatRequests([emptyAcc({})], 9);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.workspaceId).toBe(9);
    expect(req.heroIds).toEqual(["101", "102", "103"]);
    expect(req.heroLevels).toEqual([]);
    expect(req.avgEvolution).toBeCloseTo(2);
    // ownRate = (100+200)/2000 = 0.15，enemyRate = (200+400)/2000 = 0.3 → ratio = 2
    expect(req.lossExchangeRatio).toBeCloseTo(2);
    expect(req.notes).toBeNull();
  });

  it("兵力为 0 时交换比为 0 且不会出现 NaN", () => {
    const requests = buildLineupStatRequests([
      emptyAcc({ totalOriginTroops: 0, totalEnemyOriginTroops: 0 }),
    ], 1);
    expect(requests[0].lossExchangeRatio).toBe(0);
  });
});

describe("aggregatePlayerLineupStats（P0 过滤口径）", () => {
  it("合法阵容正常进入 stat", () => {
    const stats = aggregatePlayerLineupStats([battleRecord({})]);
    expect(stats.some((s) => s.playerName === "玩家甲")).toBe(true);
  });

  it("假兵力（armyTroops ≤ 100，实为武将数）不进 stat", () => {
    const recs = [
      battleRecord({
        attacker: {
          player: { name: "玩家甲", avatarId: "av-1", allianceName: "同盟甲" },
          formationId: "1",
          heroes: [hero("101"), hero("102"), hero("103")],
          totals: { armyTroops: 3 },
        },
      }),
    ];
    const stats = aggregatePlayerLineupStats(recs);
    expect(stats.some((s) => s.playerName === "玩家甲")).toBe(false);
  });

  it("武将等级不足 46 不进 stat", () => {
    const recs = [
      battleRecord({
        defender: {
          player: { name: "玩家乙", avatarId: "av-2", allianceName: "同盟乙" },
          formationId: "2",
          heroes: [hero("201", 45), hero("202", 45), hero("203", 45)],
          totals: { armyTroops: 15000 },
        },
      }),
    ];
    const stats = aggregatePlayerLineupStats(recs);
    expect(stats.some((s) => s.playerName === "玩家乙")).toBe(false);
  });
});

describe("useLineupSync 并发守卫（P1-2）", () => {
  const noop = () => {};
  const ctx = { workspaceId: 1, allianceId: null };

  it("同步进行中 records 变化会被 pending 重触发，而非永久丢弃", async () => {
    const recA = [battleRecord({})]; // 攻击者 玩家甲
    const recB = [
      battleRecord({
        battleCode: "BC-999",
        attacker: {
          player: { name: "玩家丙", avatarId: "av-3", allianceName: "同盟甲" },
          formationId: "1",
          heroes: [hero("101"), hero("102"), hero("103")],
          totals: { armyTroops: 15000 },
        },
      }),
    ];

    const { rerender } = renderHook(
      ({ records }) => useLineupSync(records, ctx, true, noop),
      { initialProps: { records: recA } },
    );

    // 第一次同步尚在 flight 时立即切到 recB
    rerender({ records: recB });

    await waitFor(() => {
      expect(lineSyncMocks.statsMut.mutateAsync).toHaveBeenCalledTimes(2);
    });

    const calls = lineSyncMocks.statsMut.mutateAsync.mock.calls;
    const lastArg = calls[calls.length - 1][0] as PlayerLineupAcc[];
    expect(lastArg.some((s) => s.playerName === "玩家丙")).toBe(true);
  });
});

