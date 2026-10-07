import { describe, expect, it } from "vitest";
import { invalidationsFor, type MutationKind } from "./mutations";

describe("invalidationsFor", () => {
  it("createWorkspace 失效 bundle + summary 全前缀（P2-1 修复：诊断/设置页计数即时刷新）", () => {
    expect(invalidationsFor("createWorkspace")).toEqual([["bundle"], ["summary"]]);
  });

  it("startCaptureSession / stopCaptureSession 失效 bundle + collector", () => {
    expect(invalidationsFor("startCaptureSession")).toEqual([["bundle"], ["collector"]]);
    expect(invalidationsFor("stopCaptureSession")).toEqual([["bundle"], ["collector"]]);
  });

  it("saveMemberBinding / saveLineupProfile 失效 bundle + summary + lineupAnalysis", () => {
    expect(invalidationsFor("saveMemberBinding")).toEqual([["bundle"], ["summary"], ["lineupAnalysis"]]);
    expect(invalidationsFor("saveLineupProfile")).toEqual([["bundle"], ["summary"], ["lineupAnalysis"]]);
  });

  it("导出动作失效 bundle（导出会回写导出记录）", () => {
    expect(invalidationsFor("export")).toEqual([["bundle"]]);
  });

  it("pickExportDirectory / resetExportDirectory 不失效（setQueryData 直写）", () => {
    expect(invalidationsFor("pickExportDirectory")).toEqual([]);
    expect(invalidationsFor("resetExportDirectory")).toEqual([]);
  });

  it("阶段4 批量写 mutation 失效对应分片前缀", () => {
    expect(invalidationsFor("syncLineupStats")).toEqual([["lineupAnalysis"], ["summary"]]);
    expect(invalidationsFor("syncLineupMatchups")).toEqual([["lineupAnalysis"]]);
    expect(invalidationsFor("syncMemberBindings")).toEqual([["bundle"], ["summary"], ["lineupAnalysis"]]);
  });

  it("每种 mutation 的失效映射均返回 QueryKey 数组", () => {
    // 穷尽性由 invalidationMap 的 satisfies Record<MutationKind, ...> 编译期保证：
    // 新增 MutationKind 而未补映射时 tsc 直接报错，不再需要运行期长度兜底
    const kinds: MutationKind[] = [
      "createWorkspace",
      "startCaptureSession",
      "stopCaptureSession",
      "saveMemberBinding",
      "saveLineupProfile",
      "pickExportDirectory",
      "resetExportDirectory",
      "export",
      "syncLineupStats",
      "syncLineupMatchups",
      "syncMemberBindings",
    ];
    for (const kind of kinds) {
      const keys = invalidationsFor(kind);
      expect(Array.isArray(keys), `${kind} 应返回 QueryKey[]`).toBe(true);
      for (const key of keys) {
        expect(Array.isArray(key), `${kind} 的每个 key 应为数组`).toBe(true);
      }
    }
  });
});
