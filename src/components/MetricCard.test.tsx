/**
 * Tests for unified MetricCard (S1-4a).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/MetricCard.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricCard } from "./MetricCard";

describe("MetricCard", () => {
  it("渲染 label 与 value", () => {
    render(<MetricCard label="今日战报" value={42} />);
    expect(screen.getByText("今日战报")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("default 尺寸：value 使用 text-metric 度量字号", () => {
    render(<MetricCard label="m" value="99%" />);
    expect(screen.getByText("99%").className).toContain("text-metric");
  });

  it("tone=primary：卡片带 border-primary/20 bg-primary/5，value text-primary", () => {
    const { container } = render(<MetricCard label="m" value="1" tone="primary" />);
    expect(screen.getByText("1").className).toContain("text-primary");
    expect(container.firstChild).toHaveClass("border-primary/20", "bg-primary/5");
  });

  it("tone=victory/defeat/info：value 用 S0 语义令牌着色", () => {
    const { rerender } = render(<MetricCard label="m" value="1" tone="victory" />);
    expect(screen.getByText("1")).toHaveClass("text-victory");
    rerender(<MetricCard label="m" value="1" tone="defeat" />);
    expect(screen.getByText("1")).toHaveClass("text-defeat");
    rerender(<MetricCard label="m" value="1" tone="info" />);
    expect(screen.getByText("1")).toHaveClass("text-info");
  });

  it("tone=muted：value text-muted-foreground", () => {
    render(<MetricCard label="m" value="1" tone="muted" />);
    expect(screen.getByText("1")).toHaveClass("text-muted-foreground");
  });

  it("tone=default：value 无着色令牌，卡片无 primary 强调", () => {
    const { container } = render(<MetricCard label="m" value="1" />);
    const value = screen.getByText("1");
    expect(value.className).not.toContain("text-primary");
    expect(value.className).not.toContain("text-victory");
    expect(value.className).not.toContain("text-defeat");
    expect(value.className).not.toContain("text-info");
    expect(container.firstChild).not.toHaveClass("bg-primary/5");
  });

  it("size=compact：复刻 MiniStat 视觉（裸 div + truncate 小字）", () => {
    const { container } = render(<MetricCard label="士气" value="120" size="compact" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass("rounded-md", "border", "border-border", "bg-card/80", "px-3", "py-2");
    expect(screen.getByText("士气")).toHaveClass("text-xs", "text-muted-foreground");
    expect(screen.getByText("120")).toHaveClass("truncate", "text-sm", "font-medium");
  });

  it("size=compact + tone：value 着色但底座不加 primary 强调", () => {
    const { container } = render(<MetricCard label="m" value="1" size="compact" tone="victory" />);
    expect(screen.getByText("1")).toHaveClass("text-victory");
    expect(container.firstChild).not.toHaveClass("bg-primary/5");
  });

  it("interactive=true：带 cursor-pointer，点击触发 onClick 一次", () => {
    const onClick = vi.fn();
    const { container } = render(<MetricCard label="m" value="1" interactive onClick={onClick} />);
    expect(container.firstChild).toHaveClass("cursor-pointer");
    fireEvent.click(screen.getByText("1"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
