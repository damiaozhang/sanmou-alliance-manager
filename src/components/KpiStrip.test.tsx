/**
 * Tests for KpiStrip (2026-10-09 frontend redesign, plan Task 4).
 *
 * Run with: npx vitest run src/components/KpiStrip.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KpiStrip } from "./KpiStrip";

function stubRaf() {
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now() + 1000), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

describe("KpiStrip", () => {
  it("渲染每个指标的 label", () => {
    render(
      <KpiStrip
        items={[
          { label: "在册成员", value: 128 },
          { label: "今日战报", value: 216 },
        ]}
      />,
    );
    expect(screen.getByText("在册成员")).toBeInTheDocument();
    expect(screen.getByText("今日战报")).toBeInTheDocument();
  });

  it("count-up 结束后显示目标值（含 suffix）", async () => {
    stubRaf();
    render(<KpiStrip items={[{ label: "平均战力", value: 184, suffix: "万" }]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText("184万")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("delta tone=up/down 用语义色", () => {
    render(
      <KpiStrip
        items={[
          { label: "a", value: 1, delta: { text: "▲ 3", tone: "up" } },
          { label: "b", value: 2, delta: { text: "▼ 1", tone: "down" } },
        ]}
      />,
    );
    expect(screen.getByText("▲ 3")).toHaveClass("text-victory");
    expect(screen.getByText("▼ 1")).toHaveClass("text-defeat");
  });

  it("overrideText 存在时直接显示（无数据用 —，不显示 0）", () => {
    render(<KpiStrip items={[{ label: "本周胜率", value: 0, overrideText: "—" }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("数值使用 tabular-nums", async () => {
    stubRaf();
    render(<KpiStrip items={[{ label: "x", value: 7 }]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText("7").className).toContain("tabular-nums");
    vi.unstubAllGlobals();
  });
});
