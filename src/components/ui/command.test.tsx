/**
 * Command 元件（cmdk 封装）行为测试。
 *
 * 覆盖三条核心交互契约：输入过滤、↑↓ 循环选择（loop）、Enter 触发 onSelect。
 * 这些原本由 AppShell 手写实现，现委托给 cmdk——测试的意义是
 * "升级/更换底层库时，用户可感知的行为不回退"。
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";

// cmdk 依赖 ResizeObserver（测量列表高度）与 scrollIntoView（选中项滚入视野），
// jsdom 均未实现，测试环境补桩。
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  Element.prototype.scrollIntoView = vi.fn();
});

function Palette({ onSelect }: { onSelect: (v: string) => void }) {
  return (
    <Command loop>
      <CommandInput placeholder="搜索…" />
      <CommandList>
        <CommandEmpty>没有匹配的页面</CommandEmpty>
        <CommandGroup heading="采集">
          <CommandItem onSelect={() => onSelect("capture")} keywords={["采集"]}>
            同盟快照
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="数据">
          <CommandItem onSelect={() => onSelect("alliance")}>同盟数据</CommandItem>
          <CommandItem onSelect={() => onSelect("lineup")}>阵容中心</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

describe("Command（cmdk 封装）", () => {
  it("输入过滤后只剩匹配项，无匹配时显示空态文案", () => {
    const { rerender } = render(<Palette onSelect={vi.fn()} />);

    const input = screen.getByPlaceholderText("搜索…");
    fireEvent.change(input, { target: { value: "阵容" } });
    expect(screen.getByText("阵容中心")).toBeInTheDocument();
    expect(screen.queryByText("同盟快照")).not.toBeInTheDocument();

    rerender(<Palette onSelect={vi.fn()} />);
    fireEvent.change(input, { target: { value: "不存在的页面" } });
    expect(screen.getByText("没有匹配的页面")).toBeInTheDocument();
  });

  it("Enter 触发当前选中项的 onSelect", () => {
    const onSelect = vi.fn();
    render(<Palette onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("搜索…");
    // 默认选中第一项：同盟快照
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("capture");
  });

  it("ArrowDown 在 loop 模式下循环选择", () => {
    const onSelect = vi.fn();
    render(<Palette onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("搜索…");
    // 3 项循环：第 1 次 ↓ 到第 2 项，第 2 次 ↓ 到第 3 项，第 3 次 ↓ 回到第 1 项
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("lineup");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("capture");
  });

  it("keywords 参与过滤（分组名可搜）", () => {
    render(<Palette onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索…"), { target: { value: "采集" } });
    expect(screen.getByText("同盟快照")).toBeInTheDocument();
    expect(screen.queryByText("同盟数据")).not.toBeInTheDocument();
  });
});
