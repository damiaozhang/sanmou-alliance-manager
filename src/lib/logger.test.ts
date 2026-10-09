import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logger, setLogLevel, getLogLevel } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info");
  });

  it("默认 info 级别：debug 不输出", () => {
    setLogLevel("info");
    logger.debug("test");
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("debug 级别：所有级别都输出", () => {
    setLogLevel("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("error 级别：仅 error 输出", () => {
    setLogLevel("error");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("输出包含时间戳和级别", () => {
    setLogLevel("info");
    logger.info("采集开始", { captureType: "alliance_data" });
    const call = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] \[INFO\] 采集开始/);
    expect(call).toContain('"captureType":"alliance_data"');
  });

  it("getLogLevel 返回当前级别", () => {
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
  });
});
