/**
 * Tests for useToggleSort (S1-4b).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/hooks/useToggleSort.test.ts
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useToggleSort } from "./useToggleSort";

describe("useToggleSort", () => {
  it("返回初始排序态", () => {
    const { result } = renderHook(() =>
      useToggleSort({ key: "contribution" as "a" | "contribution", direction: "desc" })
    );
    expect(result.current.sort).toEqual({ key: "contribution", direction: "desc" });
  });

  it("同一列三态轮换：desc → asc → desc", () => {
    const { result } = renderHook(() => useToggleSort({ key: "a" as "a" | "b", direction: "desc" }));
    act(() => result.current.toggle("a"));
    expect(result.current.sort).toEqual({ key: "a", direction: "asc" });
    act(() => result.current.toggle("a"));
    expect(result.current.sort).toEqual({ key: "a", direction: "desc" });
  });

  it("切换新列回到 desc 并更新 key", () => {
    const { result } = renderHook(() => useToggleSort({ key: "a" as "a" | "b", direction: "asc" }));
    act(() => result.current.toggle("b"));
    expect(result.current.sort).toEqual({ key: "b", direction: "desc" });
  });
});
