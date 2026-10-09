import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { validateIpcResponse, safeParseIpcResponse } from "./ipcValidation";
import type { AppBundle, CollectorStatus, WorkspaceSummary } from "./bindings";

const summary: WorkspaceSummary = {
  workspaceCount: 1,
  allianceCount: 1,
  captureSessionCount: 0,
  rawArtifactCount: 0,
  exportJobCount: 0,
  memberSnapshotCount: 0,
  buildingSnapshotCount: 0,
  battleBlockCount: 0,
  lineupProfileCount: 0,
  databasePath: "demo.db",
};

const bundle: AppBundle = {
  summary,
  workspaces: [],
  captureSessions: [],
  rawArtifacts: [],
  exportJobs: [],
  allianceMembers: [],
  allianceFacilities: [],
  allianceGroups: [],
  lineupProfiles: [],
  memberBindings: [],
};

describe("validateIpcResponse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("null/undefined 返回 false", () => {
    expect(validateIpcResponse("AppBundle", null)).toBe(false);
    expect(validateIpcResponse("AppBundle", undefined)).toBe(false);
  });

  it("非对象类型返回 false", () => {
    expect(validateIpcResponse("AppBundle", "string")).toBe(false);
    expect(validateIpcResponse("AppBundle", 123)).toBe(false);
    expect(validateIpcResponse("AppBundle", [])).toBe(false);
  });

  it("AppBundle 缺少必填字段返回 false", () => {
    expect(validateIpcResponse("AppBundle", {})).toBe(false);
    expect(validateIpcResponse("AppBundle", { allianceMembers: [] })).toBe(false);
  });

  it("AppBundle 字段类型错误返回 false", () => {
    expect(
      validateIpcResponse("AppBundle", {
        allianceMembers: "not-array",
        summary: {},
        workspaces: [],
        lineupProfiles: [],
      }),
    ).toBe(false);
  });

  it("AppBundle 正确数据返回 true", () => {
    expect(validateIpcResponse("AppBundle", bundle)).toBe(true);
  });

  it("WorkspaceSummary 校验数值字段", () => {
    expect(validateIpcResponse("WorkspaceSummary", summary)).toBe(true);
    expect(
      validateIpcResponse("WorkspaceSummary", {
        workspaceCount: 1,
        battleBlockCount: "not-number",
        memberSnapshotCount: 0,
      }),
    ).toBe(false);

    expect(
      validateIpcResponse("WorkspaceSummary", {
        workspaceCount: 1,
        battleBlockCount: 100,
        memberSnapshotCount: 50,
      }),
    ).toBe(true);
  });

  it("CollectorStatus 使用当前 IPC 状态字段", () => {
    expect(
      validateIpcResponse("CollectorStatus", { available: false, mode: "preview", message: "ready", captureFlows: {} }),
    ).toBe(true);
  });

  it("BattleReportRow 校验字符串字段", () => {
    expect(
      validateIpcResponse("BattleReportRow", {
        battleCode: "code-1",
        time: "2026-01-01",
        result: "win",
      }),
    ).toBe(true);

    expect(
      validateIpcResponse("BattleReportRow", {
        battleCode: 123,
        time: "2026-01-01",
        result: "win",
      }),
    ).toBe(false);
  });

  it("未知类型跳过校验返回 true", () => {
    expect(validateIpcResponse("UnknownType" as never, {})).toBe(true);
  });
});

describe("safeParseIpcResponse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("校验通过返回数据", () => {
    const data: CollectorStatus = { available: true, mode: "preview", message: "ready", captureFlows: {} };
    const result = safeParseIpcResponse("CollectorStatus", data);
    expect(result).toEqual(data);
  });

  it("校验失败返回 null", () => {
    const result = safeParseIpcResponse("CollectorStatus", {
      available: "yes",
      mode: "preview",
      message: "ready",
      captureFlows: {},
    });
    expect(result).toBeNull();
  });
});
