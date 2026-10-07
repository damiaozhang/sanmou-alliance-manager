/**
 * Tests for SearchInput (S1-4b).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/SearchInput.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("受控：输入触发 onChange 并传出新值", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="搜索阵容" />);
    fireEvent.change(screen.getByPlaceholderText("搜索阵容"), { target: { value: "张辽" } });
    expect(onChange).toHaveBeenCalledWith("张辽");
  });

  it("空值时不显示清除按钮", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByLabelText("清除搜索")).not.toBeInTheDocument();
  });

  it("有值时显示清除按钮，点击后 onChange 收到空串", () => {
    const onChange = vi.fn();
    render(<SearchInput value="张辽" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("清除搜索"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
