import { describe, expect, it } from "vitest";
import { classifyBattle } from "./battleClassify";

describe("classifyBattle (S3 战报分类)", () => {
  it("默认野战：无攻城类型码/场景/高回合", () => {
    expect(classifyBattle({ combatType: 1, scenarioId: 0, endRound: 3, location: "1,2" }).category).toBe("野战");
  });

  it("攻城系 combatType → 攻城", () => {
    expect(classifyBattle({ combatType: 5, scenarioId: 0, endRound: 6, location: "" }).category).toBe("攻城");
    expect(classifyBattle({ combatType: 8, scenarioId: 0, endRound: 4, location: "" }).category).toBe("攻城");
  });

  it("攻城系 + 高回合（≥12）→ 守城", () => {
    const r = classifyBattle({ combatType: 7, scenarioId: 0, endRound: 15, location: "" });
    expect(r.category).toBe("守城");
    expect(r.reason).toContain("15 回合");
  });

  it("攻城场景 ID → 攻城（即使 combatType 非攻城系）", () => {
    expect(classifyBattle({ combatType: 0, scenarioId: 11, endRound: 5, location: "" }).category).toBe("攻城");
  });

  it("敌方多连队（≥3）→ 集结", () => {
    expect(classifyBattle({ combatType: 1, scenarioId: 0, endRound: 4, location: "", defenderArmies: 4 }).category).toBe("集结");
    expect(classifyBattle({ combatType: 5, scenarioId: 0, endRound: 2, location: "", defenderArmies: 5 }).category).toBe("集结");
  });

  it("敌方 1-2 连队不误判集结", () => {
    expect(classifyBattle({ combatType: 1, scenarioId: 0, endRound: 4, location: "", defenderArmies: 2 }).category).toBe("野战");
  });
});
