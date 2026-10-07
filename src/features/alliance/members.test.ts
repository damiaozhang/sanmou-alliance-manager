// features/alliance/members 单测（阶段4 自 helpers.test.ts 迁移）

import { describe, it, expect } from "vitest";
import { buildAllianceDisplayMember } from "./members";

describe('buildAllianceDisplayMember', () => {
  it('fills defaults for minimal input', () => {
    const minimal = buildAllianceDisplayMember({ name: "TestPlayer" });
    expect(minimal.avatarId).toBe("");
    expect(minimal.name).toBe("TestPlayer");
    expect(minimal.official).toBe("");
    expect(minimal.profession).toBe("");
    expect(minimal.isOnline).toBe(0);
    expect(minimal.cargoRatio).toBe(0);
  });

  it('maps all fields from full input', () => {
    const full = buildAllianceDisplayMember({
      avatarId: "AV123",
      name: "FullPlayer",
      official: "盟主",
      profession: "战士",
      isOnline: 1,
      legion: "第一军团",
      prosperity: 5000,
      contribution: 200,
      merit: 300,
      seasonScore: 450,
      lastOfflineTs: 1700000000,
      joinTs: 1690000000,
      tFeat: 150,
      tForageUse: 300,
      wForageUse: 100,
      weeklyStatisticsJson: '{"attack":10}',
      demolition: 50,
      coord: "100,200",
      status: "在线",
    });
    expect(full.avatarId).toBe("AV123");
    expect(full.official).toBe("盟主");
    expect(full.isOnline).toBe(1);
    expect(full.legion).toBe("第一军团");
    expect(full.cargoRatio).toBe(0.5);
  });

  it('prevents division by zero on cargoRatio', () => {
    const noForage = buildAllianceDisplayMember({ name: "N", tFeat: 100, tForageUse: 0 });
    expect(noForage.cargoRatio).toBe(0);
  });
});
