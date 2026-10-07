/**
 * Tests for ExportMenu (S1-4a).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/ExportMenu.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportMenu } from "./ExportMenu";

function renderMenu(overrides: Partial<Parameters<typeof ExportMenu>[0]> = {}) {
  const props = {
    items: [
      { label: "JSON", onSelect: vi.fn() },
      { label: "CSV", onSelect: vi.fn() },
    ],
    ...overrides,
  };
  render(<ExportMenu {...props} />);
  return props;
}

describe("ExportMenu", () => {
  it("渲染 trigger，默认文案「导出」", () => {
    renderMenu();
    expect(screen.getByRole("button", { name: "导出" })).toBeInTheDocument();
  });

  it("支持自定义 triggerLabel", () => {
    renderMenu({ triggerLabel: "导出数据" });
    expect(screen.getByRole("button", { name: "导出数据" })).toBeInTheDocument();
  });

  it("busy=true 时 trigger 禁用并显示「导出中…」", () => {
    renderMenu({ busy: true });
    const trigger = screen.getByRole("button", { name: "导出中…" });
    expect(trigger).toBeDisabled();
  });

  it("点开菜单后点击菜单项调用对应 onSelect，其余不调用", async () => {
    const props = renderMenu();
    const trigger = screen.getByRole("button", { name: "导出" });
    // jsdom 无 PointerEvent，radix trigger 的 pointerdown 守卫（button===0 && ctrlKey===false）
    // 读不到属性；改走 radix 键盘契约 ArrowDown 打开（与 ConfirmDialog 同为 fireEvent 直发风格），
    // 菜单项 click→onSelect 已由 react-menu 源码确认（MenuItem onClick→handleSelect）。
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await act(async () => {
      fireEvent.click(screen.getByText("CSV"));
    });
    expect(props.items[1].onSelect).toHaveBeenCalledTimes(1);
    expect(props.items[0].onSelect).not.toHaveBeenCalled();
  });
});
