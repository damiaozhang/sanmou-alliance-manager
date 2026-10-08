/**
 * Tests for the redesigned AppShell (2026-10-09 frontend redesign, plan Task 8).
 *
 * Run with: npx vitest run src/app/AppShell.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

function wrap() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppShell activeWorkspace={undefined} workspaces={[]} onSelectWorkspace={vi.fn()} scanningActive={false} />
    </MemoryRouter>,
  );
}

describe("AppShell 新外壳", () => {
  it("渲染图标轨/顶栏/HUD 脊", () => {
    const { container } = wrap();
    expect(screen.getByText("谋")).toBeInTheDocument();
    expect(screen.getByText("三谋盟管家")).toBeInTheDocument();
    expect(screen.getByText(/sidecar/)).toBeInTheDocument();
    expect(container.querySelector("footer")).not.toBeNull();
  });
  it("不再渲染面包屑分隔符与旧宽侧栏文案", () => {
    const { container } = wrap();
    expect(container.textContent).not.toContain("›");
    expect(container.textContent).not.toContain("三谋同盟管理助手");
  });
});
