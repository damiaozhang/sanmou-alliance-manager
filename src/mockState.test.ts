// mock 层收敛回归测试（阶段4）：预览模式写操作真实落入 mockState，不再假成功

import { beforeEach, describe, expect, it } from "vitest";
import { mock, mockState } from "./mockState";
import type { UpsertLineupStatRequest } from "./tauri";

function statRequest(partial: Partial<UpsertLineupStatRequest> = {}): UpsertLineupStatRequest {
  return {
    workspaceId: 1,
    avatarId: "av-1",
    playerName: "玩家甲",
    allianceName: "同盟甲",
    lineupKey: "formation:1|ids:101/102/103",
    label: "鱼鳞阵 · 甲队",
    formationId: "1",
    formationName: "鱼鳞阵",
    heroIds: ["101", "102", "103"],
    heroLevels: [50, 50, 45],
    avgEvolution: 3,
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
    lossExchangeRatio: 0.5,
    lastBattleTime: "2026-01-05 12:00:00",
    notes: null,
    ...partial,
  };
}

describe("预览模式 mock 写操作（upsertLineupStat 假成功修复）", () => {
  beforeEach(() => {
    mockState.lineupStats = [];
    mockState.lineupMatchups = [];
  });

  it("upsertLineupStat 真实写入内存库，getLineupAnalysis 可读回", () => {
    mock.upsertLineupStat(statRequest());
    const analysis = mock.getLineupAnalysis();
    expect(analysis.stats).toHaveLength(1);
    expect(analysis.stats[0].playerName).toBe("玩家甲");
    expect(analysis.stats[0].heroIdsJson).toBe(JSON.stringify(["101", "102", "103"]));
  });

  it("同 workspace+avatar+lineupKey 重复写为覆盖（upsert 语义），不产生重复行", () => {
    mock.upsertLineupStat(statRequest({ battles: 2 }));
    mock.upsertLineupStat(statRequest({ battles: 5 }));
    expect(mockState.lineupStats).toHaveLength(1);
    expect(mock.getLineupAnalysis().stats[0].battles).toBe(5);
  });

  it("批量写返回条数并落库；对阵按 battleCode+双方去重", () => {
    expect(mock.upsertLineupStatsBatch([statRequest(), statRequest({ avatarId: "av-2", playerName: "玩家乙" })])).toBe(2);
    const input = {
      workspaceId: 1,
      attackerAvatarId: "av-1",
      attackerPlayerName: "玩家甲",
      attackerLineupKey: "k1",
      attackerLineupLabel: "l1",
      defenderAvatarId: "av-2",
      defenderPlayerName: "玩家乙",
      defenderLineupKey: "k2",
      defenderLineupLabel: "l2",
      outcome: "win",
      battleTime: "2026-01-05 12:00:00",
      battleCode: "BC-1",
      matchType: 1,
      combatType: 0,
      scenarioId: 0,
      endRound: 8,
      location: "",
    };
    expect(mock.upsertLineupMatchupsBatch([input, input])).toBe(1);
    expect(mock.getLineupAnalysis().matchups).toHaveLength(1);
  });

  it("saveLineupStatNotes / deleteLineupStat 作用于内存库", () => {
    mock.upsertLineupStat(statRequest());
    const id = mockState.lineupStats[0].id;
    mock.saveLineupStatNotes(id, "备注");
    expect(mockState.lineupStats[0].notes).toBe("备注");
    mock.deleteLineupStat(id);
    expect(mockState.lineupStats).toHaveLength(0);
  });

  it("saveMemberBinding 无工作区时拒绝写入并返回 null，不产生脏数据", () => {
    mockState.workspaces = [];
    mockState.bundle.memberBindings = [];
    expect(mock.saveMemberBinding({ workspaceId: 1, allianceId: 7, avatarName: "玩家甲", avatarId: "av-1", confidence: "高" })).toBeNull();
    expect(mockState.bundle.memberBindings).toHaveLength(0);
    expect(mock.saveMemberBindings([
      { workspaceId: 1, allianceId: 7, avatarName: "玩家甲", avatarId: "av-1", confidence: "高" },
      { workspaceId: 1, allianceId: 7, avatarName: "玩家乙", avatarId: "av-2", confidence: "高" },
    ])).toBe(0);
  });

  it("saveMemberBinding 有工作区时正常写入，allianceId 来自首个工作区", () => {
    mockState.workspaces = [{ id: 10, allianceId: 7, name: "测试工作区" }] as typeof mockState.workspaces;
    mockState.bundle.memberBindings = [];
    const row = mock.saveMemberBinding({ workspaceId: 10, allianceId: 7, avatarName: "玩家甲", avatarId: "av-1", confidence: "高" });
    expect(row).not.toBeNull();
    expect(row!.allianceId).toBe(7);
    expect(mockState.bundle.memberBindings).toHaveLength(1);
    mockState.workspaces = [];
  });

  it("getAppBundle 返回拷贝而非共享引用，调用方改写数组不影响内部状态", () => {
    mockState.bundle.memberBindings = [];
    const copy = mock.getAppBundle();
    copy.memberBindings.push({ playerId: 1, name: "脏", avatar: "x", alliance: "x", status: "x", updated: "", isActive: true });
    expect(mockState.bundle.memberBindings).toHaveLength(0);
  });
});
