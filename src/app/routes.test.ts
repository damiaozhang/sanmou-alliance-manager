import { describe, expect, it } from "vitest";
import { LEGACY_VIEW_TO_PATH, resolveLegacyHash } from "./routes";

describe("resolveLegacyHash", () => {
  it("映射常规旧键到新路径", () => {
    expect(resolveLegacyHash("#dashboard")).toBe("/dashboard");
    expect(resolveLegacyHash("#alliance")).toBe("/alliance");
    expect(resolveLegacyHash("#battleGrabber")).toBe("/battle-grabber");
    expect(resolveLegacyHash("#autoCapture")).toBe("/capture");
    expect(resolveLegacyHash("#winRate")).toBe("/lineups");
  });

  it("映射别名 battles 到 /battle-grabber", () => {
    expect(resolveLegacyHash("#battles")).toBe("/battle-grabber");
  });

  it("playerProfile 无参数特例重定向到 /alliance", () => {
    expect(resolveLegacyHash("#playerProfile")).toBe("/alliance");
  });

  it("binding 自 S2-4 起降为同盟数据页 tab，重定向到 /alliance", () => {
    expect(resolveLegacyHash("#binding")).toBe("/alliance");
  });

  it("未知键返回 null", () => {
    expect(resolveLegacyHash("#nonexistent")).toBeNull();
    expect(resolveLegacyHash("#Dashboard")).toBeNull();
  });

  it("新格式 hash（#/...）返回 null，避免干扰 HashRouter", () => {
    expect(resolveLegacyHash("#/dashboard")).toBeNull();
    expect(resolveLegacyHash("#/player/123")).toBeNull();
    expect(resolveLegacyHash("#/")).toBeNull();
  });

  it("空 hash 返回 null", () => {
    expect(resolveLegacyHash("")).toBeNull();
    expect(resolveLegacyHash("#")).toBeNull();
  });
});

describe("LEGACY_VIEW_TO_PATH", () => {
  it("覆盖 13 个旧视图键 + battles 别名", () => {
    const legacyKeys = [
      "dashboard", "capture", "alliance", "battleGrabber", "battles", "lineups",
      "ranking", "binding", "comparison", "timeline", "diagnostics", "playerProfile",
      "autoCapture", "winRate",
    ];
    for (const key of legacyKeys) {
      expect(LEGACY_VIEW_TO_PATH[key], `缺少旧键映射：${key}`).toMatch(/^\//);
    }
    expect(Object.keys(LEGACY_VIEW_TO_PATH)).toHaveLength(legacyKeys.length);
  });
});
