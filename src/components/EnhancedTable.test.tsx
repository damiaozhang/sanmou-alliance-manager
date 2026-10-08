/**
 * Tests for EnhancedTable (2026-10-09 frontend redesign, plan Task 7).
 *
 * Run with: npx vitest run src/components/EnhancedTable.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnhancedTable } from "./EnhancedTable";
import { TableCell } from "@/components/ui/table";

interface Row {
  id: number;
  name: string;
  n: number;
}

const rows: Row[] = [{ id: 1, name: "龙", n: 42 }];

describe("EnhancedTable", () => {
  it("渲染表头与行内容", () => {
    render(
      <EnhancedTable
        columns={["成员", "战报"]}
        rows={rows}
        renderRow={(r) => (
          <>
            <TableCell>{r.name}</TableCell>
            <TableCell>{r.n}</TableCell>
          </>
        )}
      />,
    );
    expect(screen.getByText("成员")).toBeInTheDocument();
    expect(screen.getByText("龙")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
  it("onRowClick 触发行点击", () => {
    const onRowClick = vi.fn();
    render(
      <EnhancedTable
        columns={["成员"]}
        rows={rows}
        renderRow={(r) => <TableCell>{r.name}</TableCell>}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("龙"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
