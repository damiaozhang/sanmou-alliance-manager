/**
 * notify 封装测试（S1-3）
 *
 * 不 mock sonner：jsdom 真实渲染 <Toaster />，调用 notify.success/error/warning/info，
 * 断言文案真实出现在 DOM——验证封装真的接到了 sonner，而非 mock 空转。
 * jsdom 缺 matchMedia，测试内补 polyfill（sonner 用它探测 prefers-reduced-motion 等）。
 *
 * Run with: node node_modules/vitest/vitest.mjs run src/lib/notify.test.tsx
 */

import { render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { beforeAll, describe, expect, it } from "vitest";
import { notify } from "./notify";

beforeAll(() => {
  // jsdom 无 matchMedia，sonner 环境探测需要；补最小可用实现
  window.matchMedia =
    window.matchMedia ??
    ((query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList);
});

describe("notify（S1-3 toast 薄封装）", () => {
  it("success 文案真实出现在 Toaster DOM", async () => {
    render(<Toaster />);
    notify.success("数据已就绪");
    expect(await screen.findByText("数据已就绪")).toBeTruthy();
  });

  it("error 文案真实出现在 Toaster DOM", async () => {
    render(<Toaster />);
    notify.error("初始化失败：mock 后端不可用");
    expect(await screen.findByText("初始化失败：mock 后端不可用")).toBeTruthy();
  });

  it("warning 文案真实出现在 Toaster DOM", async () => {
    render(<Toaster />);
    notify.warning("请先选择工作区，再进行采集。");
    expect(await screen.findByText("请先选择工作区，再进行采集。")).toBeTruthy();
  });

  it("info 文案真实出现在 Toaster DOM", async () => {
    render(<Toaster />);
    notify.info("测试 info 通道");
    expect(await screen.findByText("测试 info 通道")).toBeTruthy();
  });
});
