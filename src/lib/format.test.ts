// lib/format 单测（阶段4 自 helpers.test.ts 迁移）

import { describe, it, expect } from "vitest";
import { formatWanNumber, parseLevelNumber, formatDeltaNumber } from "./format";

// --------------- formatWanNumber ---------------

describe('formatWanNumber', () => {
  it('returns dash for null', () => {
    expect(formatWanNumber(null)).toBe("-");
  });

  it('returns dash for undefined', () => {
    expect(formatWanNumber(undefined)).toBe("-");
  });

  it('returns dash for zero', () => {
    expect(formatWanNumber(0)).toBe("-");
  });

  it('returns raw number for small values', () => {
    expect(formatWanNumber(1)).toBe("1");
  });

  it('returns raw number below 10k threshold', () => {
    expect(formatWanNumber(9999)).toBe("9999");
  });

  it('formats exactly 10000 as 1万', () => {
    expect(formatWanNumber(10000)).toBe("1万");
  });

  it('formats 12345 as 1.2万', () => {
    expect(formatWanNumber(12345)).toBe("1.2万");
  });

  it('formats 15000 as 1.5万', () => {
    expect(formatWanNumber(15000)).toBe("1.5万");
  });

  it('formats 200000 as 20万', () => {
    expect(formatWanNumber(200000)).toBe("20万");
  });

  it('formats 1000000 as 100万', () => {
    expect(formatWanNumber(1000000)).toBe("100万");
  });

  it('formats exact 50000 as 5万', () => {
    expect(formatWanNumber(50000)).toBe("5万");
  });
});

// --------------- parseLevelNumber ---------------

describe('parseLevelNumber', () => {
  it('parses Lv. prefix', () => {
    expect(parseLevelNumber("Lv.15")).toBe(15);
  });

  it('parses Chinese level prefix', () => {
    expect(parseLevelNumber("等级10")).toBe(10);
  });

  it('extracts first number from mixed text', () => {
    expect(parseLevelNumber("level 3 building")).toBe(3);
  });

  it('returns 0 for text with no digits', () => {
    expect(parseLevelNumber("abc")).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseLevelNumber("")).toBe(0);
  });
});

// --------------- formatDeltaNumber ---------------

describe('formatDeltaNumber', () => {
  it('prefixes positive delta with +', () => {
    expect(formatDeltaNumber(10, 5)).toBe("+5");
  });

  it('prefixes negative delta with -', () => {
    expect(formatDeltaNumber(5, 10)).toBe("-5");
  });

  it('shows +0 for equal values', () => {
    expect(formatDeltaNumber(7, 7)).toBe("+0");
  });

  it('appends suffix to positive delta', () => {
    expect(formatDeltaNumber(10, 5, "人")).toBe("+5人");
  });

  it('appends suffix to negative percentage', () => {
    expect(formatDeltaNumber(3, 8, "%")).toBe("-5%");
  });
});
