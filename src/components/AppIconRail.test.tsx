/**
 * Tests for AppIconRail (2026-10-09 frontend redesign, plan Task 6).
 *
 * Run with: npx vitest run src/components/AppIconRail.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppIconRail } from "./AppIconRail";

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/dashboard"]}>{ui}</MemoryRouter>);
}

describe("AppIconRail", () => {
  it("渲染品牌与全部导航项（含分组）", () => {
    wrap(<AppIconRail />);
    expect(screen.getByText("谋")).toBeInTheDocument();
    expect(screen.getByTitle("总览")).toBeInTheDocument();
    expect(screen.getByTitle("同盟快照")).toBeInTheDocument();
    expect(screen.getByTitle("战报抓取")).toBeInTheDocument();
    expect(screen.getByTitle("同盟数据")).toBeInTheDocument();
    expect(screen.getByTitle("阵容中心")).toBeInTheDocument();
    expect(screen.getByTitle("时间对比")).toBeInTheDocument();
    expect(screen.getByTitle("战报时间线")).toBeInTheDocument();
    expect(screen.getByTitle("设置")).toBeInTheDocument();
  });
  it("当前路由项带 active 指示", () => {
    const { container } = wrap(<AppIconRail />);
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
  });
});
