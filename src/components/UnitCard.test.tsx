/**
 * Tests for UnitCard (2026-10-09 frontend redesign, plan Task 7).
 *
 * Run with: npx vitest run src/components/UnitCard.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitCard } from "./UnitCard";

describe("UnitCard", () => {
  it("渲染标题并使用 surface-card", () => {
    const { container } = render(<UnitCard title="最近战报">body</UnitCard>);
    expect(screen.getByText("最近战报")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("surface-card");
  });
  it("渲染 tag", () => {
    render(<UnitCard title="t" tag="近 7 天">x</UnitCard>);
    expect(screen.getByText("近 7 天")).toBeInTheDocument();
  });
});
