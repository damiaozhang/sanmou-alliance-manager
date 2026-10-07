/**
 * Tests for lib/labels：resultBadge 映射 (S1-4b)、captureTypeLabel 与 ALLIANCE_SCANNING_EMPTY (S2-1)、
 * captureStatusBadge (S3-3)。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/lib/labels.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  ALLIANCE_SCANNING_EMPTY,
  attackerOutcomeFromResult,
  captureStatusBadge,
  captureTypeLabel,
  resultBadge,
  resultBadgeVariant,
} from "./labels";

describe("attackerOutcomeFromResult", () => {
  it("攻方胜/attacker_win 是攻击方胜", () => {
    expect(attackerOutcomeFromResult("攻方胜")).toBe("win");
    expect(attackerOutcomeFromResult("attacker_win")).toBe("win");
  });

  it("守方胜/defender_win 是攻击方负", () => {
    expect(attackerOutcomeFromResult("守方胜")).toBe("loss");
    expect(attackerOutcomeFromResult("defender_win")).toBe("loss");
  });

  it("平局/draw 与未知字符串各自归类", () => {
    expect(attackerOutcomeFromResult("平局")).toBe("draw");
    expect(attackerOutcomeFromResult("交战")).toBe("unknown");
  });
});

describe("resultBadge", () => {
  it("胜：中文「胜」与英文 win 均映射 success", () => {
    expect(resultBadge("攻方胜")).toEqual({ label: "胜", variant: "success" });
    expect(resultBadge("WIN")).toEqual({ label: "胜", variant: "success" });
  });

  it("负：「负」/「败」/loss 均映射 destructive", () => {
    expect(resultBadge("攻方负")).toEqual({ label: "负", variant: "destructive" });
    expect(resultBadge("战败")).toEqual({ label: "负", variant: "destructive" });
    expect(resultBadge("loss")).toEqual({ label: "负", variant: "destructive" });
    expect(resultBadge("守方胜")).toEqual({ label: "负", variant: "destructive" });
  });

  it("平局 → 平；无法判定的字符串 → 未知（P2-3 修复：unknown 不再计入平局）", () => {
    expect(resultBadge("平局")).toEqual({ label: "平", variant: "secondary" });
    expect(resultBadge("交战")).toEqual({ label: "未知", variant: "secondary" });
    expect(resultBadge("")).toEqual({ label: "未知", variant: "secondary" });
    expect(resultBadge("unknown")).toEqual({ label: "未知", variant: "secondary" });
  });
});

describe("resultBadgeVariant", () => {
  it("胜负平 → success/destructive/secondary", () => {
    expect(resultBadgeVariant("胜")).toBe("success");
    expect(resultBadgeVariant("负")).toBe("destructive");
    expect(resultBadgeVariant("平")).toBe("secondary");
  });
});

describe("captureTypeLabel", () => {
  it("四个已知键各有定稿文案（seed_demo 系显示示例数据）", () => {
    expect(captureTypeLabel("alliance_data")).toBe("同盟采集");
    expect(captureTypeLabel("battle_passive")).toBe("战报采集");
    expect(captureTypeLabel("seed_demo")).toBe("示例数据");
    expect(captureTypeLabel("seed_demo_history")).toBe("示例数据");
  });

  it("未知类型原样透传", () => {
    expect(captureTypeLabel("custom_type")).toBe("custom_type");
  });

  it("空值与空白兜底为 -", () => {
    expect(captureTypeLabel(null)).toBe("-");
    expect(captureTypeLabel(undefined)).toBe("-");
    expect(captureTypeLabel("")).toBe("-");
    expect(captureTypeLabel("   ")).toBe("-");
  });
});

describe("ALLIANCE_SCANNING_EMPTY", () => {
  it("同盟数据采集中空态文案为采集版定稿", () => {
    expect(ALLIANCE_SCANNING_EMPTY).toBe("同盟数据正在采集中，等本次采集结束后会自动更新。");
  });
});

describe("captureStatusBadge", () => {
  it("completed → 已完成/success", () => {
    expect(captureStatusBadge("completed")).toEqual({ label: "已完成", variant: "success" });
  });

  it("running → 运行中/info", () => {
    expect(captureStatusBadge("running")).toEqual({ label: "运行中", variant: "info" });
  });

  it("failed → 失败/destructive", () => {
    expect(captureStatusBadge("failed")).toEqual({ label: "失败", variant: "destructive" });
  });

  it("stopped → 已停止/secondary", () => {
    expect(captureStatusBadge("stopped")).toEqual({ label: "已停止", variant: "secondary" });
  });

  it("未知状态原样透传，空值与空白兜底 -，均映射 secondary", () => {
    expect(captureStatusBadge("paused")).toEqual({ label: "paused", variant: "secondary" });
    expect(captureStatusBadge("")).toEqual({ label: "-", variant: "secondary" });
    expect(captureStatusBadge("   ")).toEqual({ label: "-", variant: "secondary" });
  });
});
