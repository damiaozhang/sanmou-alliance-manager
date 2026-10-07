/**
 * DataTable 通用虚拟表格组件测试（阶段3b）
 *
 * jsdom 无布局能力：用 globalThis.ResizeObserver stub + initialRect 注入容器尺寸，
 * 使 @tanstack/react-virtual 能算出可视窗口并渲染虚拟项。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/components/DataTable.test.tsx
 */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";

// jsdom 没有 ResizeObserver，@tanstack/react-virtual 依赖其测量滚动容器
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom 无布局能力：virtual-core 的 getRect 读 element.offsetWidth/offsetHeight（挂载时立即覆盖 initialRect），
// 故 mock 为固定 800×400，使虚拟化能算出可视窗口并渲染虚拟项
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Row {
  id: number;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: "id", header: "编号", width: "80px", render: (r) => r.id },
  { key: "name", header: "名称", width: "1fr", render: (r) => r.name },
];

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `成员${i + 1}` }));
}

const INITIAL_RECT = { width: 800, height: 400 };

describe("DataTable", () => {
  it("渲染表头、虚拟行与分页器文案", () => {
    const rows = makeRows(50);
    render(
      <DataTable
        rows={rows.slice(0, 20)}
        total={rows.length}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
        columns={columns}
        rowKey={(r) => r.id}
        initialRect={INITIAL_RECT}
      />,
    );
    expect(screen.getByText("编号")).toBeTruthy();
    expect(screen.getByText("名称")).toBeTruthy();
    // 虚拟化应渲染出首批行（initialRect 高 400 / 行高 40 + overscan）
    expect(screen.getByText("成员1")).toBeTruthy();
    // 分页器：共 50 条 · 第 1/3 页
    expect(screen.getByText("共 50 条 · 第 1/3 页")).toBeTruthy();
    expect((screen.getByRole("button", { name: /上一页/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("空数据显示 emptyTitle", () => {
    render(
      <DataTable
        rows={[]}
        total={0}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
        columns={columns}
        rowKey={(r) => r.id}
        emptyTitle="暂无日志"
        initialRect={INITIAL_RECT}
      />,
    );
    expect(screen.getByText("暂无日志")).toBeTruthy();
  });

  it("点击下一页回调新页码，点击行回调该行", () => {
    const onPageChange = vi.fn();
    const onRowClick = vi.fn();
    const rows = makeRows(60);
    render(
      <DataTable
        rows={rows.slice(20, 40)}
        total={rows.length}
        page={2}
        pageSize={20}
        onPageChange={onPageChange}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        initialRect={INITIAL_RECT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /下一页/ }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByText("成员21"));
    expect(onRowClick).toHaveBeenCalledWith(rows[20]);
  });

  it("受控翻页（harness）：页码越界时钳制到最后一页", () => {
    function Harness() {
      const rows = makeRows(45);
      const [page, setPage] = useState(1);
      const pageSize = 20;
      const start = (page - 1) * pageSize;
      return (
        <DataTable
          rows={rows.slice(start, start + pageSize)}
          total={rows.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          columns={columns}
          rowKey={(r) => r.id}
          initialRect={INITIAL_RECT}
        />
      );
    }
    render(<Harness />);
    // 翻到第 3 页（最后一页，25 条窗口内的成员41）
    fireEvent.click(screen.getByRole("button", { name: /下一页/ }));
    fireEvent.click(screen.getByRole("button", { name: /下一页/ }));
    expect(screen.getByText("共 45 条 · 第 3/3 页")).toBeTruthy();
    // 最后一页下一页禁用
    expect((screen.getByRole("button", { name: /下一页/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
