/**
 * Tests for HudStatusBar (2026-10-09 frontend redesign, plan Task 5).
 *
 * Run with: npx vitest run src/components/HudStatusBar.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HudStatusBar } from "./HudStatusBar";

describe("HudStatusBar", () => {
  it("sidecar 在线显示 pulse 点与版本", () => {
    render(<HudStatusBar sidecarOnline sidecarVersion="1.0.3" />);
    expect(screen.getByText(/1\.0\.3/)).toBeInTheDocument();
    expect(screen.getByText("在线")).toBeInTheDocument();
  });
  it("sidecar 离线显示离线", () => {
    render(<HudStatusBar sidecarOnline={false} sidecarVersion="1.0.3" />);
    expect(screen.getByText("离线")).toBeInTheDocument();
  });
  it("告警计数以 warning 色呈现", () => {
    render(<HudStatusBar sidecarOnline sidecarVersion="1" alertCount={5} />);
    expect(screen.getByText("5")).toHaveClass("text-warning");
  });
  it("渲染工作区与新鲜度", () => {
    render(
      <HudStatusBar
        sidecarOnline
        sidecarVersion="1"
        workspaceName="龙城 Alliance"
        freshness="2 分钟前"
      />,
    );
    expect(screen.getByText("龙城 Alliance")).toBeInTheDocument();
    expect(screen.getByText("2 分钟前")).toBeInTheDocument();
  });
});
