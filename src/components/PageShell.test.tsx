/**
 * Tests for PageShell.
 *
 * 2026-09-21 重设计：PageShell 由「容器 + 可选 description/actions」升级为
 * 三段式页面骨架（title / description+actions / toolbar），本文件随之更新断言，
 * 并保留旧契约的向后兼容性用例。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/PageShell.test.tsx
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageShell } from "./PageShell";

describe("PageShell", () => {
  it("渲染 children，根容器带 space-y-6 p-6", () => {
    const { container } = render(
      <PageShell>
        <p>页面内容</p>
      </PageShell>
    );
    expect(screen.getByText("页面内容")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("space-y-6", "p-6");
  });

  it("支持 className 合并", () => {
    const { container } = render(<PageShell className="max-w-5xl">x</PageShell>);
    expect(container.firstChild).toHaveClass("space-y-6", "p-6", "max-w-5xl");
  });

  it("不传 title/description/actions 时不渲染头部行（向后兼容：DOM 与扩展前一致）", () => {
    const { container } = render(
      <PageShell>
        <p>页面内容</p>
      </PageShell>
    );
    const root = container.firstChild as HTMLElement;
    expect(root.childElementCount).toBe(1);
    expect(root.firstElementChild?.tagName).toBe("P");
  });

  it("title 渲染为页面内标题 h2（重设计新增：解决滚动后失去位置感）", () => {
    render(
      <PageShell title="总览">
        <p>正文</p>
      </PageShell>
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("总览");
    expect(heading).toHaveClass("text-[17px]", "font-medium");
  });

  it("description 单独提供时带 muted 样式", () => {
    render(<PageShell description="页面说明文字">x</PageShell>);
    const desc = screen.getByText("页面说明文字");
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveClass("text-[12.5px]", "text-muted-foreground");
  });

  it("title 与 description 同时提供时 description 紧随标题下方", () => {
    render(
      <PageShell title="同盟数据" description="成员 · 组织 · 动态">
        <p>正文</p>
      </PageShell>
    );
    const desc = screen.getByText("成员 · 组织 · 动态");
    expect(desc).toHaveClass("mt-1");
    expect(desc.previousElementSibling).toHaveTextContent("同盟数据");
  });

  it("actions 渲染在头部行右侧", () => {
    render(
      <PageShell actions={<button type="button">主操作</button>}>
        x
      </PageShell>
    );
    const action = screen.getByRole("button", { name: "主操作" });
    expect(action).toBeInTheDocument();
    expect(action.parentElement).toHaveClass("flex", "shrink-0", "items-center", "gap-2");
  });

  it("description 与 actions 同时提供时渲染同一头部行", () => {
    const { container } = render(
      <PageShell description="说明" actions={<button type="button">操作</button>}>
        <p>正文</p>
      </PageShell>
    );
    const headerRow = (container.firstChild as HTMLElement).firstElementChild;
    expect(headerRow).toHaveClass("flex", "items-start", "gap-4");
    expect(headerRow).toHaveTextContent("说明");
    expect(headerRow).toHaveTextContent("操作");
  });

  it("toolbar 渲染在页头之后、children 之前", () => {
    const { container } = render(
      <PageShell
        title="同盟数据"
        toolbar={<div data-testid="toolbar">筛选条</div>}
      >
        <p>正文</p>
      </PageShell>
    );
    const root = container.firstChild as HTMLElement;
    const children = Array.from(root.children);
    const toolbarIndex = children.findIndex(
      (el) => el.getAttribute("data-testid") === "toolbar"
    );
    const bodyIndex = children.findIndex((el) => el.tagName === "P");
    expect(toolbarIndex).toBeGreaterThan(0);
    expect(toolbarIndex).toBeLessThan(bodyIndex);
  });
});
