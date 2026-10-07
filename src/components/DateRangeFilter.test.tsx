/**
 * Tests for DateRangeFilter (S1-4b).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/DateRangeFilter.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateRangeFilter } from "./DateRangeFilter";

describe("DateRangeFilter", () => {
  it("受控双输入：分别回调 onFromChange / onToChange", () => {
    const onFromChange = vi.fn();
    const onToChange = vi.fn();
    render(
      <DateRangeFilter from="2026-07-01" to="2026-07-31" onFromChange={onFromChange} onToChange={onToChange} />
    );
    fireEvent.change(screen.getByPlaceholderText("开始日期 YYYY-MM-DD"), { target: { value: "2026-07-02" } });
    expect(onFromChange).toHaveBeenCalledWith("2026-07-02");
    fireEvent.change(screen.getByPlaceholderText("结束日期 YYYY-MM-DD"), { target: { value: "2026-07-30" } });
    expect(onToChange).toHaveBeenCalledWith("2026-07-30");
  });

  it("未传 onReset 时不渲染重置按钮", () => {
    render(<DateRangeFilter from="" to="" onFromChange={() => {}} onToChange={() => {}} />);
    expect(screen.queryByText("重置")).not.toBeInTheDocument();
  });

  it("传入 onReset 时渲染重置按钮，点击触发回调", () => {
    const onReset = vi.fn();
    render(<DateRangeFilter from="" to="" onFromChange={() => {}} onToChange={() => {}} onReset={onReset} />);
    fireEvent.click(screen.getByText("重置"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
