/**
 * alliance.ts 核心解析逻辑测试（战报胜负判定 / 阵容识别 / 阵容质量校验）。
 *
 * fixture 依据 docs/STATISTICS.md 描述的真实字段结构构造
 * （battle-grabber-v6 的 alliance_battles.jsonl：battleId/recordType/winnerSide/
 * attacker{player,armyId,heroes,totals{armyTroops}}/defender{...}），
 * 名称均为脱敏后的虚构样本。
 * 断言基准 = 终审口径（平局计半胜；阵容过滤：满编 3 将、level>=46、兵力>=5000、
 * 兵力<=100 为假兵力需跳过）。
 */
import { describe, expect, it } from "vitest";
import type { JsonRecord } from "../types";
import {
  getAllianceLineupIdentity,
  getAllianceSideArmyTroops,
  getAllianceSideOutcome,
  isValidAllianceLineup,
} from "./alliance";

function hero(id: string, displayName: string, level = 50): JsonRecord {
  return { heroId: id, displayName, level, evolution: 5, enlighten: 5, remainingTroops: 4000 };
}

function side(
  playerName: string,
  allianceName: string,
  armyId: string,
  heroes: JsonRecord[],
  armyTroops: number | null,
  formationId = "401",
): JsonRecord {
  const totals: JsonRecord = {};
  if (armyTroops !== null) totals["armyTroops"] = armyTroops;
  return {
    player: { name: playerName, allianceName },
    armyId,
    heroes,
    totals,
    formationId,
    formationName: "鱼鳞阵",
  };
}

/** 构造一条贴近真实 jsonl 的同盟战报记录（字段见终审文档 §4.3）。 */
function battleReport(partial: Partial<JsonRecord> = {}): JsonRecord {
  return {
    battleId: "test-battle-001",
    recordType: "block",
    attackAlliance: "测试同盟甲",
    defendAlliance: "测试同盟乙",
    winnerSide: "attacker_win",
    battleTime: "2026-01-01 12:00:00",
    attacker: side(
      "测试玩家甲",
      "测试同盟甲",
      "9001",
      [hero("10101", "SP周瑜"), hero("10102", "诸葛亮"), hero("10103", "诸葛瑾")],
      18500,
    ),
    defender: side(
      "测试玩家乙",
      "测试同盟乙",
      "9002",
      [hero("20101", "刘备"), hero("20102", "张飞"), hero("20103", "魏延")],
      17200,
    ),
    ...partial,
  };
}

describe("getAllianceSideOutcome（终审口径：winnerSide 优先，平局计半胜基础）", () => {
  it("attacker_win：攻方 win、守方 loss", () => {
    const record = battleReport({ winnerSide: "attacker_win" });
    expect(getAllianceSideOutcome(record, "attack")).toBe("win");
    expect(getAllianceSideOutcome(record, "defend")).toBe("loss");
  });

  it("defender_win：攻方 loss、守方 win", () => {
    const record = battleReport({ winnerSide: "defender_win" });
    expect(getAllianceSideOutcome(record, "attack")).toBe("loss");
    expect(getAllianceSideOutcome(record, "defend")).toBe("win");
  });

  it("draw（双方存活脱离）：两侧均为 draw，只计出场不计胜负", () => {
    const record = battleReport({ winnerSide: "draw" });
    expect(getAllianceSideOutcome(record, "attack")).toBe("draw");
    expect(getAllianceSideOutcome(record, "defend")).toBe("draw");
  });

  it("兼容旧枚举 attack_win / defend_win", () => {
    expect(getAllianceSideOutcome(battleReport({ winnerSide: "attack_win" }), "attack")).toBe("win");
    expect(getAllianceSideOutcome(battleReport({ winnerSide: "defend_win" }), "defend")).toBe("win");
  });

  it("winnerSide 缺失时回退 result 文案（攻方胜/守方胜/平局）", () => {
    const win = battleReport({ winnerSide: undefined, result: "攻方胜" });
    expect(getAllianceSideOutcome(win, "attack")).toBe("win");
    expect(getAllianceSideOutcome(win, "defend")).toBe("loss");
    const loss = battleReport({ winnerSide: undefined, result: "守方胜" });
    expect(getAllianceSideOutcome(loss, "attack")).toBe("loss");
    const draw = battleReport({ winnerSide: undefined, result: "平局" });
    expect(getAllianceSideOutcome(draw, "defend")).toBe("draw");
  });

  it("outcome 无法解析时为 unknown（不得误判为胜/负）", () => {
    const record = battleReport({ winnerSide: undefined, result: "交战" });
    expect(getAllianceSideOutcome(record, "attack")).toBe("unknown");
    expect(getAllianceSideOutcome(record, "defend")).toBe("unknown");
    const empty = battleReport({ winnerSide: undefined, result: undefined });
    expect(getAllianceSideOutcome(empty, "attack")).toBe("unknown");
  });

  it("child 子战报（中间回合）与 block 同样按 winnerSide 判定", () => {
    // 合成案例：child 测试玩家甲击败测试玩家丙，随后 block 负于测试玩家乙
    const child = battleReport({
      recordType: "child",
      parentBattleId: "test-battle-001",
      battleId: "test-battle-001-1",
      winnerSide: "attacker_win",
      defender: side("测试玩家丙", "测试同盟乙", "9003", [hero("20104", "孙坚"), hero("20105", "左慈"), hero("20106", "田丰")], 0),
    });
    expect(getAllianceSideOutcome(child, "attack")).toBe("win");
  });
});

describe("getAllianceLineupIdentity（阵容识别）", () => {
  it("满编侧返回 key/label/ids，key 含阵型与排序后的武将 ID", () => {
    const record = battleReport({});
    const identity = getAllianceLineupIdentity(record, "attack");
    expect(identity).not.toBeNull();
    expect(identity!.key).toBe("formation:401|ids:10101/10102/10103");
    expect(identity!.ids).toEqual(["10101", "10102", "10103"]);
    expect(identity!.label).toContain("鱼鳞阵");
    expect(identity!.player).toBe("测试玩家甲");
    expect(identity!.armyId).toBe("9001");
    expect(identity!.heroLevels).toEqual([50, 50, 50]);
  });

  it("child 战报的 parentBattleId 指向 block 的 battleId", () => {
    const child = battleReport({ recordType: "child", parentBattleId: "test-battle-001", battleId: "test-battle-001-1" });
    const identity = getAllianceLineupIdentity(child, "attack");
    expect(identity!.parentBattleId).toBe("test-battle-001");
  });

  it("无任何阵容线索时返回 null", () => {
    const record = battleReport({ attacker: { player: { name: "测试玩家甲" } } });
    expect(getAllianceLineupIdentity(record, "attack")).toBeNull();
  });
});

describe("isValidAllianceLineup（终审口径阵容过滤）", () => {
  it("满编 3 将、level>=46、兵力>=5000 → 有效", () => {
    expect(isValidAllianceLineup(battleReport({}), "attack")).toBe(true);
    expect(isValidAllianceLineup(battleReport({}), "defend")).toBe(true);
  });

  it("阈值边界：level=46 且兵力=5000 恰好有效", () => {
    const record = battleReport({
      attacker: side(
        "边界队",
        "测试同盟甲",
        "9009",
        [hero("10101", "SP周瑜", 46), hero("10102", "诸葛亮", 46), hero("10103", "诸葛瑾", 46)],
        5000,
      ),
    });
    expect(isValidAllianceLineup(record, "attack")).toBe(true);
  });

  it("child 残队（少于 3 将）→ 无效", () => {
    const record = battleReport({
      recordType: "child",
      attacker: side("残队", "测试同盟甲", "9008", [hero("10101", "SP周瑜"), hero("10102", "诸葛亮")], 8000),
    });
    expect(isValidAllianceLineup(record, "attack")).toBe(false);
  });

  it("兵力缺失 → 无效", () => {
    const record = battleReport({
      attacker: side("无兵力", "测试同盟甲", "9007", [hero("10101", "SP周瑜"), hero("10102", "诸葛亮"), hero("10103", "诸葛瑾")], null),
    });
    expect(getAllianceSideArmyTroops(record, "attack")).toBe(0);
    expect(isValidAllianceLineup(record, "attack")).toBe(false);
  });

  it("假兵力（armyTroops <= 100，实为武将数）→ 无效", () => {
    const record = battleReport({
      recordType: "child",
      attacker: side("假兵力", "测试同盟甲", "9006", [hero("10101", "SP周瑜"), hero("10102", "诸葛亮"), hero("10103", "诸葛瑾")], 3),
    });
    expect(isValidAllianceLineup(record, "attack")).toBe(false);
    const hundred = battleReport({
      attacker: side("假兵力百", "测试同盟甲", "9005", [hero("10101", "SP周瑜"), hero("10102", "诸葛亮"), hero("10103", "诸葛瑾")], 100),
    });
    expect(isValidAllianceLineup(hundred, "attack")).toBe(false);
  });

  it("兵力低于 5000（非假兵力区间）→ 无效", () => {
    const record = battleReport({
      attacker: side("低兵力", "测试同盟甲", "9004", [hero("10101", "SP周瑜"), hero("10102", "诸葛亮"), hero("10103", "诸葛瑾")], 4999),
    });
    expect(isValidAllianceLineup(record, "attack")).toBe(false);
  });

  it("任一武将 level < 46 → 无效", () => {
    const record = battleReport({
      attacker: side("低等级", "测试同盟甲", "9003", [hero("10101", "SP周瑜", 50), hero("10102", "诸葛亮", 50), hero("10103", "诸葛瑾", 45)], 16000),
    });
    expect(isValidAllianceLineup(record, "attack")).toBe(false);
  });

  it("armyTroops 缺失时回退 totals.originTroops（旧数据兼容）", () => {
    const record = battleReport({});
    (record["attacker"] as JsonRecord)["totals"] = { originTroops: 16000 };
    expect(getAllianceSideArmyTroops(record, "attack")).toBe(16000);
    expect(isValidAllianceLineup(record, "attack")).toBe(true);
  });
});
