/**
 * Tests for ErrorState (S1-4b).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/ErrorState.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("渲染 message 文案", () => {
    render(<ErrorState message="活跃预警加载失败：boom" />);
    expect(screen.getByText("活跃预警加载失败：boom")).toBeInTheDocument();
  });

  it("使用 text-sm text-destructive 视觉", () => {
    render(<ErrorState message="出错了" />);
    expect(screen.getByText("出错了")).toHaveClass("text-sm", "text-destructive");
  });
});
