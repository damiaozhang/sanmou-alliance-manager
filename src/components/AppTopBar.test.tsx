/**
 * Tests for AppTopBar (2026-10-09 frontend redesign, plan Task 6).
 *
 * Run with: npx vitest run src/components/AppTopBar.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppTopBar } from "./AppTopBar";

describe("AppTopBar", () => {
  it("渲染产品名与当前页标题", () => {
    render(<AppTopBar viewTitle="总览" onOpenPalette={vi.fn()} shortcutLabel="Ctrl K" />);
    expect(screen.getByText("三谋盟管家")).toBeInTheDocument();
    expect(screen.getByText("总览")).toBeInTheDocument();
  });
  it("点击搜索胶囊触发 onOpenPalette", () => {
    const onOpenPalette = vi.fn();
    render(<AppTopBar viewTitle="总览" onOpenPalette={onOpenPalette} shortcutLabel="Ctrl K" />);
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
  it("不渲染面包屑分隔符", () => {
    const { container } = render(
      <AppTopBar
        viewTitle="总览"
        workspaceName="龙城"
        onOpenPalette={vi.fn()}
        shortcutLabel="Ctrl K"
      />,
    );
    expect(container.textContent).not.toContain("›");
  });
});
