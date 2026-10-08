/**
 * Tests for PageHead (2026-10-09 frontend redesign, plan Task 3).
 *
 * Run with: npx vitest run src/components/PageHead.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHead } from "./PageHead";

describe("PageHead", () => {
  it("渲染标题与口径说明", () => {
    render(<PageHead title="总览" description="口径：全部在册成员" />);
    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.getByText("口径：全部在册成员")).toBeInTheDocument();
  });
  it("渲染 actions 区", () => {
    render(
      <PageHead
        title="t"
        actions={<button type="button">刷新</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
  });
  it("无 description 时不渲染空段落", () => {
    const { container } = render(<PageHead title="t" />);
    expect(container.querySelectorAll("p").length).toBe(0);
  });
});
