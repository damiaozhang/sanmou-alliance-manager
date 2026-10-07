/**
 * Tests for EmptyState / EmptyTableRow (S1-4b).
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/EmptyState.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, EmptyTableRow } from "./EmptyState";

describe("EmptyState", () => {
  it("渲染 title，使用 text-sm text-muted-foreground 段落式视觉", () => {
    const { container } = render(<EmptyState title="暂无数据" />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("text-sm", "text-muted-foreground");
  });

  it("渲染可选 description，位于 title 之后", () => {
    render(<EmptyState title="暂无数据" description="请先采集" />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(screen.getByText("请先采集")).toBeInTheDocument();
  });

  it("支持 className 追加", () => {
    const { container } = render(<EmptyState title="x" className="py-8" />);
    expect(container.firstChild).toHaveClass("py-8");
  });

  it("渲染可选 action 为 outline 小按钮，点击触发 onClick（S3-1）", () => {
    const onClick = vi.fn();
    render(<EmptyState title="还没有采集记录。" action={{ label: "去采集中心", onClick }} />);
    const button = screen.getByRole("button", { name: "去采集中心" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("不传 action 时不渲染任何按钮（向后兼容）", () => {
    render(<EmptyState title="暂无数据" description="请先采集" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyTableRow", () => {
  it("渲染 tr>td[colSpan]，td 居中且内嵌空态文案", () => {
    render(
      <table>
        <tbody>
          <EmptyTableRow colSpan={9} title="暂无导出任务。" />
        </tbody>
      </table>
    );
    const cell = screen.getByText("暂无导出任务。").closest("td");
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute("colspan", "9");
    expect(cell).toHaveClass("text-center");
  });
});
