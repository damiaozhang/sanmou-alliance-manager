// lib/dates 单测（阶段4 自 helpers.test.ts 迁移）

import { describe, it, expect } from "vitest";
import { dateKey, localDateKey, mondayWeekStart, formatCaptureRecordTime } from "./dates";

// --------------- dateKey ---------------

describe('dateKey', () => {
  it('extracts date from ISO string', () => {
    expect(dateKey("2024-03-15T10:30:00Z")).toBe("2024-03-15");
  });

  it('returns date-only string unchanged', () => {
    expect(dateKey("2024-03-15")).toBe("2024-03-15");
  });

  it('returns empty string for empty input', () => {
    expect(dateKey("")).toBe("");
  });

  it('returns short year string unchanged', () => {
    expect(dateKey("2024")).toBe("2024");
  });
});

// --------------- dateKey 与 localDateKey 口径一致性（2026-09-21 时区回归） ---------------
//
// 旧实现 dateKey = value.slice(0, 10)，取的是 **UTC** 日期；而 localDateKey 取本地日期。
// 两者口径不一致：在 UTC+8 的凌晨 00:00–07:59，当天所有记录的 dateKey 都落在前一天，
// 直接后果是总览页「今日战报」恒为 0、战报时间线按天分组错位。
// （S3-1 时区修复只覆盖了 localDateKey，本函数被漏掉，且当时没有测试覆盖。）

describe('dateKey 与 localDateKey 口径一致', () => {
  it('本地凌晨的记录仍归属本地当天', () => {
    // 本地 01:00 —— UTC+8 下其 ISO 表示里的日期部分是前一天，旧实现会判错
    const earlyMorning = new Date(2026, 8, 21, 1, 0, 0);
    expect(dateKey(earlyMorning.toISOString())).toBe("2026-09-21");
    expect(dateKey(earlyMorning.toISOString())).toBe(localDateKey(earlyMorning));
  });

  it('本地深夜的记录仍归属本地当天', () => {
    const lateNight = new Date(2026, 8, 21, 23, 30, 0);
    expect(dateKey(lateNight.toISOString())).toBe("2026-09-21");
    expect(dateKey(lateNight.toISOString())).toBe(localDateKey(lateNight));
  });

  it('全天 24 个时刻下 dateKey(iso) 恒等于对应本地日期', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const d = new Date(2026, 8, 21, hour, 15, 0);
      expect(dateKey(d.toISOString()), `本地 ${hour} 点`).toBe(localDateKey(d));
    }
  });

  it('「今日战报」计数在凌晨时段不再归零', () => {
    // 复刻总览页口径：todayKey = localDateKey(now)，逐条比对 dateKey(r.time)
    const now = new Date(2026, 8, 21, 3, 47, 0); // 本地凌晨 3:47
    const todayKey = localDateKey(now);
    const reports = [
      new Date(2026, 8, 21, 1, 0, 0).toISOString(), // 本地 09-21 01:00
      new Date(2026, 8, 21, 2, 30, 0).toISOString(), // 本地 09-21 02:30
      new Date(2026, 8, 20, 22, 0, 0).toISOString(), // 本地 09-20 22:00（昨天）
    ];
    // 旧实现在 UTC+8 下这里会得到 0 —— 三条全部被算成 09-20
    expect(reports.filter((t) => dateKey(t) === todayKey)).toHaveLength(2);
  });
});

// --------------- localDateKey（S3-1 时区修复） ---------------

describe('localDateKey', () => {
  it('取本地年月日，不经过 toISOString', () => {
    // 本地 23:30：UTC+ 时区下 toISOString 已是次日，localDateKey 必须仍返回本地当天
    const d = new Date(2024, 2, 15, 23, 30, 0);
    expect(localDateKey(d)).toBe("2024-03-15");
  });

  it('月日补零', () => {
    expect(localDateKey(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(localDateKey(new Date(2024, 11, 31))).toBe("2024-12-31");
  });

  it('本地凌晨不受 UTC 偏移影响', () => {
    // 本地 00:30：UTC- 时区下 toISOString 仍在前一日，localDateKey 必须返回本地当天
    expect(localDateKey(new Date(2024, 5, 1, 0, 30, 0))).toBe("2024-06-01");
  });
});

// --------------- mondayWeekStart（S3-1 周起始修复） ---------------

describe('mondayWeekStart', () => {
  it('周日归属于本周一（2024-03-17 周日 → 2024-03-11）', () => {
    const start = mondayWeekStart(new Date(2024, 2, 17, 15, 0, 0));
    expect(localDateKey(start)).toBe("2024-03-11");
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('周一当天即本周起始', () => {
    expect(localDateKey(mondayWeekStart(new Date(2024, 2, 18, 9, 0, 0)))).toBe("2024-03-18");
  });

  it('周六归本周一（2024-03-16 周六 → 2024-03-11）', () => {
    expect(localDateKey(mondayWeekStart(new Date(2024, 2, 16, 23, 59, 59)))).toBe("2024-03-11");
  });
});

// --------------- formatCaptureRecordTime ---------------

describe('formatCaptureRecordTime', () => {
  it('returns dash for null', () => {
    expect(formatCaptureRecordTime(null)).toBe("-");
  });

  it('returns dash for undefined', () => {
    expect(formatCaptureRecordTime(undefined)).toBe("-");
  });

  it('formats valid ISO string into display format', () => {
    const result = formatCaptureRecordTime("2024-03-15T10:30:00Z");
    expect(result).not.toBe("-");
    expect(result).not.toBe("2024-03-15T10:30:00Z");
  });

  it('returns invalid date string as-is', () => {
    expect(formatCaptureRecordTime("not-a-date")).toBe("not-a-date");
  });
});
