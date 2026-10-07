// P2-2 Phase 1 回归测试：同盟战报记录改为「按需拉取」后的快照合并语义。
//
// 背景：`alliance_records` 曾随每次 snapshot 全量下发（单 workspace 可达 60+ MB），
// 现在快照只带 `allianceRecordCount`，记录由 `get_alliance_records` 拉取一次后
// 存在前端 state 里。这里守住三条不变量：
//   1. 规范化快照时必须**保留**本地已拉取的记录（否则每次刷新都会把表格清空）
//   2. 轮询快照（applyLiveCaptureSnapshot）只更新条数，不动记录
//   3. 条数可来自快照 payload 或本地已拉取结果
import { describe, expect, it } from "vitest";

import type { AppSnapshot, LiveCaptureSnapshot } from "../types";
import { applyLiveCaptureSnapshot, EMPTY_SNAPSHOT_CONST, normaliseSnapshot } from "./battle";

const RECORDS = [{ recordType: "block", battleId: "B1" }, { recordType: "child", battleId: "B2" }];

function snapshotWithRecords(): AppSnapshot {
  return { ...EMPTY_SNAPSHOT_CONST, allianceRecords: RECORDS, allianceRecordCount: RECORDS.length };
}

describe("normaliseSnapshot / applyLiveCaptureSnapshot（P2-2 Phase 1）", () => {
  it("保留本地按需拉取的记录，并在快照未带记录时沿用条数", () => {
    const previous = snapshotWithRecords();
    const next = normaliseSnapshot({ version: 3, scanWorkspace: "0730", logs: [] }, previous);

    expect(next.allianceRecords).toEqual(RECORDS);
    expect(next.allianceRecordCount).toBe(RECORDS.length);
    expect(next.version).toBe(3);
    expect(next.scanWorkspace).toBe("0730");
  });

  it("后端仍携带记录时以 payload 为准（兼容旧后端 / 桥事件）", () => {
    const previous = snapshotWithRecords();
    const next = normaliseSnapshot({ allianceRecords: [RECORDS[0]], allianceRecordCount: 1 }, previous);

    expect(next.allianceRecords).toEqual([RECORDS[0]]);
    expect(next.allianceRecordCount).toBe(1);
  });

  it("无 payload 时退化到 previous（不把已有数据清空）", () => {
    const previous = snapshotWithRecords();
    expect(normaliseSnapshot(null, previous)).toBe(previous);
    expect(normaliseSnapshot(null)).toBe(EMPTY_SNAPSHOT_CONST);
  });

  it("轮询快照只更新条数，不动已拉取的记录", () => {
    const previous = snapshotWithRecords();
    const payload = {
      scanWorkspace: "0730",
      workspaceOutputDir: "",
      connection: previous.connection,
      logs: [],
      packets: [],
      reports: [],
      allianceRecordCount: 5703,
    } as unknown as LiveCaptureSnapshot;

    const next = applyLiveCaptureSnapshot(previous, payload);
    expect(next.allianceRecords).toEqual(RECORDS);
    expect(next.allianceRecordCount).toBe(5703);
  });

  it("空快照常量的条数为 0", () => {
    expect(EMPTY_SNAPSHOT_CONST.allianceRecords).toEqual([]);
    expect(EMPTY_SNAPSHOT_CONST.allianceRecordCount).toBe(0);
  });
});
