/**
 * Tests for battle-grabber format helpers (P2 修复：formatCount 非法值返回「—」)。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/battle-grabber/utils/format.test.ts
 */

import { describe, expect, it } from "vitest";
import { formatCount, formatOptionalNumber } from "./format";

describe("formatCount", () => {
  it("正常数字用千分位本地化", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(-5)).toBe("-5");
  });

  it("undefined / null / NaN 返回「—」（未知不伪装成 0）", () => {
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(null)).toBe("—");
    expect(formatCount(NaN)).toBe("—");
  });
});

describe("formatOptionalNumber", () => {
  it("null 返回「-」，数字走 formatCount", () => {
    expect(formatOptionalNumber(null)).toBe("-");
    expect(formatOptionalNumber(42)).toBe("42");
  });
});
