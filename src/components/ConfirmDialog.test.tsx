/**
 * Tests for ConfirmDialog (S0-T3).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/ConfirmDialog.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: "确认恢复数据？",
    description: "恢复将用备份覆盖当前全部数据，此操作不可撤销。",
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe("ConfirmDialog", () => {
  it("open=true 时渲染 title 与 description", () => {
    renderDialog();
    expect(screen.getByText("确认恢复数据？")).toBeInTheDocument();
    expect(screen.getByText("恢复将用备份覆盖当前全部数据，此操作不可撤销。")).toBeInTheDocument();
  });

  it("open=false 时不渲染内容", () => {
    renderDialog({ open: false });
    expect(screen.queryByText("确认恢复数据？")).not.toBeInTheDocument();
  });

  it("点击确认调用 onConfirm 一次", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("点击取消触发 onOpenChange(false) 且不调用 onConfirm", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("支持自定义确认/取消文案", () => {
    renderDialog({ confirmText: "确认恢复", cancelText: "再想想" });
    expect(screen.getByRole("button", { name: "确认恢复" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再想想" })).toBeInTheDocument();
  });

  it("destructive=true 时确认按钮带 destructive 样式类", () => {
    renderDialog({ destructive: true });
    const confirmButton = screen.getByRole("button", { name: "确认" });
    expect(confirmButton.className).toContain("bg-destructive");
  });

  it("destructive=false 时确认按钮不带 destructive 样式类", () => {
    renderDialog({ destructive: false });
    const confirmButton = screen.getByRole("button", { name: "确认" });
    expect(confirmButton.className).not.toContain("bg-destructive");
  });
});
