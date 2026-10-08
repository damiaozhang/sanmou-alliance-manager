/**
 * Tests for LiveSessionCard (2026-10-09 frontend redesign, plan Task 7).
 *
 * Run with: npx vitest run src/components/LiveSessionCard.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveSessionCard } from "./LiveSessionCard";

describe("LiveSessionCard", () => {
  it("active 时显示 pulse 点与计时", () => {
    render(
      <LiveSessionCard active version="1.0.3" fetched={312} target={500} elapsedLabel="00:14:37" />,
    );
    expect(screen.getByText("00:14:37")).toBeInTheDocument();
    expect(screen.getByText(/312/)).toBeInTheDocument();
    expect(screen.getByText(/采集中/)).toBeInTheDocument();
  });
  it("非 active 显示未采集", () => {
    render(
      <LiveSessionCard active={false} version="1.0.3" fetched={0} target={0} elapsedLabel="—" />,
    );
    expect(screen.getByText(/未采集/)).toBeInTheDocument();
  });
});
