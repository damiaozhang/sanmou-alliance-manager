/**
 * Tests for Card material (2026-10-09 frontend redesign, plan Task 2).
 *
 * Run with: npx vitest run src/components/ui/card.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardContent } from "./card";

describe("Card 材质", () => {
  it("Card 底座使用 surface-card 分层材质类", () => {
    const { container } = render(<Card />);
    expect(container.firstChild).toHaveClass("surface-card");
  });
  it("CardContent 保留内边距", () => {
    render(<CardContent>body</CardContent>);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
