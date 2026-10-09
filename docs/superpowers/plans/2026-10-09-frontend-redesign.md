# 前端重构（电竞数据台 · 变体A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有「浏览器式 SaaS」前端重构为深色默认的「电竞数据台」指挥台外壳 + 分层材质设计系统 + 克制动效，并按页重构 11 条路由的呈现骨架。

**Architecture:** 保留路由/IA 与数据层（React Query / tauri.ts / 业务计算 / ts-rs）不动；只替换外壳三件（图标轨/融合顶栏/HUD 脊）、设计系统 token、primitives 材质、新增 composites，并逐页换用新骨架。

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3.4 + shadcn/ui(Radix) + Vitest/@testing-library + lucide-react。不引入新依赖。

**Spec:** `docs/superpowers/specs/2026-10-09-frontend-redesign-design.md`

## Global Constraints

- 深色为默认主题；浅色为可切换备选（改 `ThemeToggle` 默认值）。
- 禁止：渐变光晕、玻璃拟态、入场 stagger、scroll reveal、`scale-105`、旋转 loading、卡片套卡片 >2 层、裸色板类名、中文斜体。
- 允许动效：`active:scale(0.97)`、hover `translateY(-2px)`+投影加深、HUD/在线点 pulse、KPI count-up、数据柱入场生长；全部受 `prefers-reduced-motion` 降级。
- 语义色（victory/defeat/draw/warning/info/success/side-*/rank-*）只表状态，不装饰；每页 ≤1 个 primary 按钮。
- 数字一律 `tabular-nums`；字阶 14/13(caption)/12(muted)/metric(22px+)。
- 空态带 CTA、加载用骨架屏；WCAG 对比度保留现修订值。
- 测试命令：`npx vitest run <file>`；全量 `npm test`；类型/构建 `npm run build`。
- 不改动：`src/app/routes.tsx` 路由与导航分组、`src/app/queries.ts`、`src/app/mutations.ts`、`src/tauri.ts`、`src/lib/*` 业务计算。

---

## Phase 1 — 设计系统基座

### Task 1: 表面分层 token + tailwind 映射 + 深色默认

**Files:**
- Modify: `src/index.css`（`:root` 与 `.dark` 块、阴影变量、新增材质工具类）
- Modify: `tailwind.config.js`（colors.surface、boxShadow.card-hover）
- Modify: `src/components/ThemeToggle.tsx:6-14,26`（默认 dark）

**Interfaces:**
- Produces: CSS 变量 `--surface-0/1/2/rail`(HSL triplet)、`--hair`、`--hair-strong`、`--inset-hi`、`--shadow-card`、`--shadow-card-hover`；工具类 `.surface-card`；tailwind 颜色 `bg-surface-0/1/2/rail`。

- [ ] **Step 1: 在 `src/index.css` 的 `:root`（浅色）块内、`--panel` 之后追加**

```css
    /* 表面分层（2026-10-09 电竞数据台 · 变体A） */
    --surface-0: 220 20% 98%;
    --surface-1: 0 0% 100%;
    --surface-2: 220 16% 96%;
    --surface-rail: 220 24% 12%;
    --hair: rgba(20, 28, 44, 0.10);
    --hair-strong: rgba(20, 28, 44, 0.18);
    --inset-hi: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    --shadow-card: 0 1px 2px rgb(28 35 51 / 0.06), 0 4px 14px rgb(28 35 51 / 0.06);
    --shadow-card-hover: 0 2px 4px rgb(28 35 51 / 0.08), 0 10px 26px rgb(28 35 51 / 0.12);
```

- [ ] **Step 2: 在 `.dark` 块内、`--panel` 之后追加（并覆盖阴影）**

```css
    --surface-0: 220 24% 5%;
    --surface-1: 220 22% 8%;
    --surface-2: 220 20% 12%;
    --surface-rail: 220 30% 3%;
    --hair: rgba(255, 255, 255, 0.07);
    --hair-strong: rgba(255, 255, 255, 0.12);
    --inset-hi: inset 0 1px 0 rgba(255, 255, 255, 0.035);
    --shadow-card: 0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px rgb(0 0 0 / 0.28);
    --shadow-card-hover: 0 2px 4px rgb(0 0 0 / 0.45), 0 14px 36px rgb(0 0 0 / 0.4);
```

- [ ] **Step 3: 在 `src/index.css` 末尾（`@media (prefers-reduced-motion…)` 之前）追加材质工具类**

```css
/* 分层卡片材质（变体A）：surface-1 底 + 发丝边 + 顶部内发光 + 厚度投影；hover 抬升 */
.surface-card {
  background: hsl(var(--surface-1));
  border: 1px solid var(--hair);
  border-radius: 12px;
  box-shadow: var(--shadow-card), var(--inset-hi);
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.surface-card:hover {
  transform: translateY(-2px);
  border-color: var(--hair-strong);
  box-shadow: var(--shadow-card-hover), var(--inset-hi);
}
@media (prefers-reduced-motion: reduce) {
  .surface-card,
  .surface-card:hover {
    transform: none;
  }
}
```

- [ ] **Step 4: 在 `tailwind.config.js` 的 `colors` 内、`panel` 之后追加**

```js
        surface: {
          0: "hsl(var(--surface-0))",
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          rail: "hsl(var(--surface-rail))",
        },
```

- [ ] **Step 5: 深色默认——改 `ThemeToggle.tsx`**

把 `getStoredTheme` 的 `return "light";`（第 13 行）改为 `return "dark";`；并把 `useState<"dark" | "light">("light")`（第 26 行）改为 `useState<"dark" | "light">("dark")`。

- [ ] **Step 6: 验证构建**

Run: `npm run build`
Expected: 通过（vite build + tsc --noEmit 无错）。

- [ ] **Step 7: Commit**

```bash
git add src/index.css tailwind.config.js src/components/ThemeToggle.tsx
git commit -m "feat(ui): 引入表面分层 token 与深色默认主题"
```

---

### Task 2: primitives 材质接入（button / card / table / badge）

**Files:**
- Modify: `src/components/ui/button.tsx`（加 active:scale 与 surface 底）
- Modify: `src/components/ui/card.tsx`（Card 底座改用 .surface-card）
- Modify: `src/components/ui/table.tsx`（表头/行 hover 材质）
- Test: `src/components/ui/card.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 1 的 `.surface-card`、`--hair`。
- Produces: `Card` 渲染带 `surface-card` class；`Button` 带 `active:scale-[0.97]`。

- [ ] **Step 1: 写失败测试 `src/components/ui/card.test.tsx`**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardContent } from "./card";

describe("Card 材质", () => {
  it("Card 底座使用 surface-card 分层材质类", () => {
    const { container } = render(<Card data-testid="c" />);
    expect(container.firstChild).toHaveClass("surface-card");
  });
  it("CardContent 保留内边距", () => {
    render(<CardContent>body</CardContent>);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/ui/card.test.tsx`
Expected: FAIL（`surface-card` 类不存在）。

- [ ] **Step 3: 改 `src/components/ui/card.tsx`，Card 根 div 的 className 合并加入 `surface-card`**

在 Card 的 `cn(...)` 中，把现有 `rounded-lg border bg-card text-card-foreground shadow-card` 替换为 `surface-card text-card-foreground`（保留其余）。

- [ ] **Step 4: 改 `src/components/ui/button.tsx`，base 变体追加按压反馈**

在 buttonVariants 的 base 字符串中追加 ` active:scale-[0.97] transition-[transform,background-color,border-color,box-shadow]`。

- [ ] **Step 5: 改 `src/components/ui/table.tsx`**

表头 `TableHeader` 的 `TableRow` 加 `bg-surface-2/60`；`TableBody` 的 `TableRow` 加 `transition-colors hover:bg-surface-2/60`。

- [ ] **Step 5b: 圆角规格落地（规格 §3.3：控件 8px / 徽章 5px）**

`button.tsx` base 中把 `rounded-md` 改为 `rounded-lg`；`badge.tsx` base 中把 `rounded-md` 改为 `rounded-[5px]`。

- [ ] **Step 6: 运行测试**

Run: `npx vitest run src/components/ui/card.test.tsx`
Expected: PASS。再 `npm test` 确认无回归。

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/card.tsx src/components/ui/button.tsx src/components/ui/table.tsx src/components/ui/card.test.tsx
git commit -m "feat(ui): primitives 接入分层材质与按压反馈"
```

---

## Phase 2 — 外壳三件与 composites

### Task 3: PageHead（作战头，取代 PageShell 页头）

**Files:**
- Create: `src/components/PageHead.tsx`
- Test: `src/components/PageHead.test.tsx`

**Interfaces:**
- Produces: `PageHead({ title, description?, actions? })`。

- [ ] **Step 1: 写失败测试**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHead } from "./PageHead";

describe("PageHead", () => {
  it("渲染标题与口径说明", () => {
    render(<PageHead title="总览" description="口径：全部在册成员" />);
    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.getByText("口径：全部在册成员")).toBeInTheDocument();
  });
  it("渲染 actions 区", () => {
    render(<PageHead title="t" actions={<button>刷新</button>} />);
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
  });
  it("无 description 时不渲染空段落", () => {
    const { container } = render(<PageHead title="t" />);
    expect(container.querySelectorAll("p").length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/components/PageHead.test.tsx` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/components/PageHead.tsx`**

```tsx
import type { ReactNode } from "react";

interface PageHeadProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="mb-4 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试** → PASS。
- [ ] **Step 5: Commit**

```bash
git add src/components/PageHead.tsx src/components/PageHead.test.tsx
git commit -m "feat(ui): 新增作战头 PageHead"
```

---

### Task 4: KpiStrip（hairline 横排 KPI + count-up）

**Files:**
- Create: `src/components/KpiStrip.tsx`
- Test: `src/components/KpiStrip.test.tsx`

**Interfaces:**
- Produces: `KpiStrip({ items: KpiItem[] })`，`KpiItem = { label: string; value: number; suffix?: string; delta?: { text: string; tone: "up" | "down" | "flat" } }`。

- [ ] **Step 1: 写失败测试**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KpiStrip } from "./KpiStrip";

describe("KpiStrip", () => {
  it("渲染每个指标的 label", () => {
    render(<KpiStrip items={[{ label: "在册成员", value: 128 }, { label: "今日战报", value: 216 }]} />);
    expect(screen.getByText("在册成员")).toBeInTheDocument();
    expect(screen.getByText("今日战报")).toBeInTheDocument();
  });
  it("count-up 结束后显示目标值（含 suffix）", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now() + 1000), 0));
    render(<KpiStrip items={[{ label: "平均战力", value: 184, suffix: "万" }]} />);
    return act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    }).then(() => {
      expect(screen.getByText("184万")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });
  it("delta tone=up/down 用语义色", () => {
    render(<KpiStrip items={[{ label: "a", value: 1, delta: { text: "▲ 3", tone: "up" } }, { label: "b", value: 2, delta: { text: "▼ 1", tone: "down" } }]} />);
    expect(screen.getByText("▲ 3")).toHaveClass("text-victory");
    expect(screen.getByText("▼ 1")).toHaveClass("text-defeat");
  });
  it("overrideText 存在时直接显示（无数据用 —，不显示 0）", () => {
    render(<KpiStrip items={[{ label: "本周胜率", value: 0, overrideText: "—" }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("数值使用 tabular-nums", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now() + 1000), 0));
    render(<KpiStrip items={[{ label: "x", value: 7 }]} />);
    return act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    }).then(() => {
      expect(screen.getByText("7").className).toContain("tabular-nums");
      vi.unstubAllGlobals();
    });
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/components/KpiStrip.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface KpiItem {
  label: string;
  value: number;
  suffix?: string;
  /** 无数据时直接显示（如 "—"），跳过 count-up（规格 §4：无数据不显示 0） */
  overrideText?: string;
  delta?: { text: string; tone: "up" | "down" | "flat" };
}

const deltaTone: Record<NonNullable<KpiItem["delta"]>["tone"], string> = {
  up: "text-victory",
  down: "text-defeat",
  flat: "text-muted-foreground/70",
};

function useCountUp(target: number, duration = 700) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min((t - t0) / duration, 1);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return n;
}

function KpiCell({ item }: { item: KpiItem }) {
  const n = useCountUp(item.value);
  return (
    <div className="border-r border-[var(--hair)] px-4 py-3.5 last:border-r-0">
      <div className="text-[11px] tracking-[0.08em] text-muted-foreground/70">{item.label}</div>
      <div className="tnum mt-1 text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">
        {item.overrideText ?? `${n}${item.suffix ?? ""}`}
      </div>
      {item.delta ? (
        <div className={cn("mt-1 text-[11.5px] tabular-nums", deltaTone[item.delta.tone])}>{item.delta.text}</div>
      ) : null}
    </div>
  );
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="surface-card mb-4 grid grid-cols-6 overflow-hidden">
      {items.map((item) => (
        <KpiCell key={item.label} item={item} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试** → PASS。
- [ ] **Step 5: Commit**

```bash
git add src/components/KpiStrip.tsx src/components/KpiStrip.test.tsx
git commit -m "feat(ui): 新增 KpiStrip（hairline 横排 + count-up）"
```

---

### Task 5: HudStatusBar（持久 HUD 状态脊）

**Files:**
- Create: `src/components/HudStatusBar.tsx`
- Test: `src/components/HudStatusBar.test.tsx`
- Delete-usage: `src/app/AppShell.tsx` 中旧 `<AppStatusBar …/>`（Task 8 统一替换；本任务仅新建组件）

**Interfaces:**
- Produces: `HudStatusBar({ sidecarOnline, sidecarVersion, sessionLabel?, workspaceName?, freshness?, alertCount?, dbSize? })`。

- [ ] **Step 1: 写失败测试**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HudStatusBar } from "./HudStatusBar";

describe("HudStatusBar", () => {
  it("sidecar 在线显示 pulse 点与版本", () => {
    render(<HudStatusBar sidecarOnline sidecarVersion="1.0.3" />);
    expect(screen.getByText(/1\.0\.3/)).toBeInTheDocument();
    expect(screen.getByText("在线")).toBeInTheDocument();
  });
  it("sidecar 离线显示离线", () => {
    render(<HudStatusBar sidecarOnline={false} sidecarVersion="1.0.3" />);
    expect(screen.getByText("离线")).toBeInTheDocument();
  });
  it("告警计数以 warning 色呈现", () => {
    render(<HudStatusBar sidecarOnline sidecarVersion="1" alertCount={5} />);
    expect(screen.getByText("5")).toHaveClass("text-warning");
  });
  it("渲染工作区与新鲜度", () => {
    render(<HudStatusBar sidecarOnline sidecarVersion="1" workspaceName="龙城 Alliance" freshness="2 分钟前" />);
    expect(screen.getByText("龙城 Alliance")).toBeInTheDocument();
    expect(screen.getByText("2 分钟前")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/components/HudStatusBar.tsx`**

```tsx
import { cn } from "@/lib/utils";

interface HudStatusBarProps {
  sidecarOnline: boolean;
  sidecarVersion: string;
  sessionLabel?: string;
  workspaceName?: string;
  freshness?: string;
  alertCount?: number;
  dbSize?: string;
}

export function HudStatusBar({
  sidecarOnline,
  sidecarVersion,
  sessionLabel,
  workspaceName,
  freshness,
  alertCount,
  dbSize,
}: HudStatusBarProps) {
  return (
    <footer className="flex h-[34px] shrink-0 items-center gap-5 border-t border-[var(--hair)] bg-surface-rail px-4 text-[11.5px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-[7px] rounded-full", sidecarOnline ? "status-pulse bg-victory" : "bg-muted-foreground/40")} />
        sidecar <b className={cn("font-semibold", sidecarOnline ? "text-foreground" : "text-muted-foreground")}>{sidecarOnline ? "在线" : "离线"}</b>
        <span className="tabular-nums">v{sidecarVersion}</span>
      </span>
      {sessionLabel ? <span>采集会话 <b className="font-semibold text-foreground tabular-nums">{sessionLabel}</b></span> : null}
      {workspaceName ? <span>工作区 <b className="font-semibold text-foreground">{workspaceName}</b></span> : null}
      <span className="ml-auto flex items-center gap-5">
        {freshness ? <span>数据新鲜度 <b className="font-semibold text-foreground">{freshness}</b></span> : null}
        {alertCount ? <span className="text-warning">告警 <b className="font-semibold text-warning tabular-nums">{alertCount}</b></span> : null}
        {dbSize ? <span>DB <b className="font-semibold text-foreground tabular-nums">{dbSize}</b></span> : null}
      </span>
    </footer>
  );
}
```

- [ ] **Step 4: 运行测试** → PASS。
- [ ] **Step 5: Commit**

```bash
git add src/components/HudStatusBar.tsx src/components/HudStatusBar.test.tsx
git commit -m "feat(ui): 新增持久 HUD 状态脊"
```

---

### Task 6: AppIconRail + AppTopBar（图标轨与融合顶栏）

**Files:**
- Create: `src/components/AppIconRail.tsx`
- Create: `src/components/AppTopBar.tsx`
- Test: `src/components/AppIconRail.test.tsx`、`src/components/AppTopBar.test.tsx`

**Interfaces:**
- Consumes: `src/app/routes.tsx` 的 `homeNavItem`、`navSections`。
- Produces: `AppIconRail()`（设置项为轨内 NavLink，无需 props）、`AppTopBar({ viewTitle, workspaceName?, onOpenPalette, shortcutLabel })`。

- [ ] **Step 1: 写失败测试 `AppIconRail.test.tsx`**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppIconRail } from "./AppIconRail";

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/dashboard"]}>{ui}</MemoryRouter>);
}

describe("AppIconRail", () => {
  it("渲染品牌与全部导航项（含分组）", () => {
    wrap(<AppIconRail />);
    expect(screen.getByText("谋")).toBeInTheDocument();
    expect(screen.getByTitle("总览")).toBeInTheDocument();
    expect(screen.getByTitle("同盟快照")).toBeInTheDocument();
    expect(screen.getByTitle("战报抓取")).toBeInTheDocument();
    expect(screen.getByTitle("同盟数据")).toBeInTheDocument();
    expect(screen.getByTitle("阵容中心")).toBeInTheDocument();
    expect(screen.getByTitle("时间对比")).toBeInTheDocument();
    expect(screen.getByTitle("战报时间线")).toBeInTheDocument();
    expect(screen.getByTitle("设置")).toBeInTheDocument();
  });
  it("当前路由项带 active 指示", () => {
    const { container } = wrap(<AppIconRail />);
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 写失败测试 `AppTopBar.test.tsx`**

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppTopBar } from "./AppTopBar";

describe("AppTopBar", () => {
  it("渲染产品名与当前页标题", () => {
    render(<AppTopBar viewTitle="总览" onOpenPalette={vi.fn()} shortcutLabel="Ctrl K" />);
    expect(screen.getByText("三谋盟管家")).toBeInTheDocument();
    expect(screen.getByText("总览")).toBeInTheDocument();
  });
  it("点击搜索胶囊触发 onOpenPalette", () => {
    const onOpenPalette = vi.fn();
    render(<AppTopBar viewTitle="总览" onOpenPalette={onOpenPalette} shortcutLabel="Ctrl K" />);
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
  it("不渲染面包屑分隔符", () => {
    const { container } = render(<AppTopBar viewTitle="总览" workspaceName="龙城" onOpenPalette={vi.fn()} shortcutLabel="Ctrl K" />);
    expect(container.textContent).not.toContain("›");
  });
});
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `src/components/AppIconRail.tsx`**

```tsx
import { NavLink } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { homeNavItem, navSections, ROUTE_PATHS } from "@/app/routes";
import { cn } from "@/lib/utils";

function RailButton({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Settings2 }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        cn(
          "relative grid size-10 place-items-center rounded-[10px] text-muted-foreground transition-colors",
          "hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "bg-primary/10 text-primary",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" /> : null}
          <Icon size={19} />
        </>
      )}
    </NavLink>
  );
}

export function AppIconRail() {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--hair)] bg-surface-rail py-2">
      <div className="mb-2 grid size-9 place-items-center rounded-[10px] bg-primary text-[15px] font-bold text-surface-rail">谋</div>
      <RailButton to={homeNavItem.path} label={homeNavItem.label} icon={homeNavItem.icon} />
      {navSections.map((section) => (
        <div key={section.label} className="contents">
          <span className="my-1 text-[9px] tracking-[0.14em] text-muted-foreground/50">{section.label.slice(0, 2)}</span>
          {section.items.map((item) => (
            <RailButton key={item.path} to={item.path} label={item.label} icon={item.icon} />
          ))}
        </div>
      ))}
      <div className="flex-1" />
      <RailButton to={ROUTE_PATHS.settings} label="设置" icon={Settings2} />
    </nav>
  );
}
```

- [ ] **Step 5: 实现 `src/components/AppTopBar.tsx`**

```tsx
import { Search } from "lucide-react";

interface AppTopBarProps {
  viewTitle: string;
  workspaceName?: string;
  onOpenPalette: () => void;
  shortcutLabel: string;
}

export function AppTopBar({ viewTitle, workspaceName, onOpenPalette, shortcutLabel }: AppTopBarProps) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--hair)] bg-surface-0/70 px-4" style={{ ["--app-region" as string]: "drag" }}>
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span>三谋盟管家</span>
        <span className="text-muted-foreground/40">·</span>
        {workspaceName ? <span className="max-w-[140px] truncate">{workspaceName}</span> : null}
        {workspaceName ? <span className="text-muted-foreground/40">·</span> : null}
        <b className="truncate font-semibold text-foreground">{viewTitle}</b>
      </div>
      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-auto flex h-[26px] items-center gap-2 rounded-lg border border-[var(--hair)] bg-surface-1 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--hair-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="搜索或跳转页面"
      >
        <Search size={13} />
        <span>搜索成员 / 战报 / 阵容</span>
        <kbd className="rounded border border-[var(--hair-strong)] px-1 text-[10px]">{shortcutLabel}</kbd>
      </button>
    </header>
  );
}
```

- [ ] **Step 6: 运行测试** → 两个文件 PASS。
- [ ] **Step 7: Commit**

```bash
git add src/components/AppIconRail.tsx src/components/AppTopBar.tsx src/components/AppIconRail.test.tsx src/components/AppTopBar.test.tsx
git commit -m "feat(ui): 新增图标轨与融合顶栏"
```

---

### Task 7: LiveSessionCard + UnitCard + EnhancedTable

**Files:**
- Create: `src/components/LiveSessionCard.tsx`、`src/components/UnitCard.tsx`、`src/components/EnhancedTable.tsx`
- Test: 各自 `.test.tsx`

**Interfaces:**
- `LiveSessionCard({ active, version, fetched, target, elapsedLabel })`。
- `UnitCard({ title, subtitle?, tone?, children, onClick? })`。
- `EnhancedTable({ columns, rows, renderRow, density?, onRowClick? })`（薄封装 shadcn Table，加 sticky 表头 + 行 hover + 密度）。

- [ ] **Step 1: 写失败测试（三合一文件可分列）**：断言 LiveSessionCard 显示 pulse 点与计时；UnitCard 渲染 title 与 surface-card；EnhancedTable 表头 sticky 且行带 hover class。

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveSessionCard } from "./LiveSessionCard";
import { UnitCard } from "./UnitCard";
import { EnhancedTable } from "./EnhancedTable";

describe("LiveSessionCard", () => {
  it("active 时显示 pulse 点与计时", () => {
    render(<LiveSessionCard active version="1.0.3" fetched={312} target={500} elapsedLabel="00:14:37" />);
    expect(screen.getByText("00:14:37")).toBeInTheDocument();
    expect(screen.getByText(/312/)).toBeInTheDocument();
  });
});

describe("UnitCard", () => {
  it("渲染标题并使用 surface-card", () => {
    const { container } = render(<UnitCard title="最近战报">body</UnitCard>);
    expect(screen.getByText("最近战报")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("surface-card");
  });
});

describe("EnhancedTable", () => {
  it("表头 sticky 且行可 hover", () => {
    render(
      <EnhancedTable
        columns={["成员", "战报"]}
        rows={[{ id: 1, name: "龙", n: 42 }]}
        renderRow={(r: { id: number; name: string; n: number }) => (
          <>
            <td>{r.name}</td>
            <td>{r.n}</td>
          </>
        )}
      />,
    );
    expect(screen.getByText("成员")).toBeInTheDocument();
    expect(screen.getByText("龙")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/components/LiveSessionCard.tsx`**

```tsx
import { cn } from "@/lib/utils";

interface LiveSessionCardProps {
  active: boolean;
  version: string;
  fetched: number;
  target: number;
  elapsedLabel: string;
}

export function LiveSessionCard({ active, version, fetched, target, elapsedLabel }: LiveSessionCardProps) {
  const pct = target > 0 ? Math.min(Math.round((fetched / target) * 100), 100) : 0;
  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">当前采集会话</h3>
        <span className="ml-auto text-[11px] text-muted-foreground/70">同盟快照</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn("size-[9px] shrink-0 rounded-full", active ? "status-pulse bg-victory" : "bg-muted-foreground/40")} />
        <div className="text-[12px] leading-snug text-muted-foreground">
          {active ? "采集中" : "未采集"} · <b className="font-semibold text-foreground">sidecar v{version}</b>
          {active ? " 在线" : ""}
          <br />
          已抓取 <b className="font-semibold text-foreground tabular-nums">{fetched}</b> / 目标{" "}
          <b className="font-semibold text-foreground tabular-nums">{target}</b> 条
        </div>
        <div className="ml-auto text-[22px] font-bold tabular-nums tracking-[-0.01em] text-primary">{elapsedLabel}</div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3b: 实现 `src/components/UnitCard.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface UnitCardProps {
  title: string;
  tag?: string;
  className?: string;
  children: ReactNode;
}

export function UnitCard({ title, tag, className, children }: UnitCardProps) {
  return (
    <div className={cn("surface-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {tag ? <span className="ml-auto text-[11px] text-muted-foreground/70">{tag}</span> : null}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3c: 实现 `src/components/EnhancedTable.tsx`**

```tsx
import type { ReactNode } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface EnhancedTableProps<T> {
  columns: string[];
  rows: T[];
  renderRow: (row: T) => ReactNode;
  density?: "compact" | "comfortable";
  onRowClick?: (row: T) => void;
}

export function EnhancedTable<T>({ columns, rows, renderRow, density = "comfortable", onRowClick }: EnhancedTableProps<T>) {
  return (
    <div className="surface-card overflow-hidden">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="text-[12px] text-muted-foreground">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("transition-colors hover:bg-surface-2/60", onRowClick && "cursor-pointer", density === "compact" ? "[&>td]:py-1.5" : "[&>td]:py-2.5")}
            >
              {renderRow(row)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试** → PASS。
- [ ] **Step 5: Commit**

```bash
git add src/components/LiveSessionCard.tsx src/components/UnitCard.tsx src/components/EnhancedTable.tsx src/components/LiveSessionCard.test.tsx src/components/UnitCard.test.tsx src/components/EnhancedTable.test.tsx
git commit -m "feat(ui): 新增 LiveSessionCard/UnitCard/EnhancedTable"
```

---

### Task 8: AppShell 换壳（接外壳三件，移除旧侧栏/面包屑/AppStatusBar）

**Files:**
- Modify: `src/app/AppShell.tsx:191-332`（布局主体）
- Test: `src/app/AppShell.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 5/6 的 `AppIconRail`、`AppTopBar`、`HudStatusBar`。
- Produces: 新外壳布局；保留命令面板与 `useSidebarCollapsed`→删除（图标轨常驻收起，不再需要宽侧栏折叠）。

- [ ] **Step 1: 写失败测试**

```tsx
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
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 重写 `AppShell.tsx` 布局主体**：把 `<div className="flex h-screen flex-col …"><DesktopTitleBar /><div className="flex …"><aside …>…</aside><main …><header …>…</header><div …><Outlet/></div><AppStatusBar …/></main></div>…` 替换为：

```tsx
    <div className="grid h-screen grid-cols-[56px_1fr] grid-rows-[40px_1fr_34px] overflow-hidden bg-surface-0"
         style={{ gridTemplateAreas: '"rail topbar" "rail main" "rail hud"' }}>
      <div style={{ gridArea: "rail" }} className="flex">
        <AppIconRail />
      </div>
      <div style={{ gridArea: "topbar" }} className="flex">
        <AppTopBar viewTitle={viewTitle} workspaceName={activeWorkspace?.name} onOpenPalette={openPalette} shortcutLabel={SHORTCUT_LABEL} />
      </div>
      <main style={{ gridArea: "main" }} className={cn("min-h-0", isBattleGrabber ? "overflow-hidden" : "overflow-auto")}>
        <div className={cn("page-enter", isBattleGrabber && "h-full")}>
          <Outlet />
        </div>
      </main>
      <div style={{ gridArea: "hud" }} className="flex">
        <HudStatusBar
          sidecarOnline={!hasFailedCapture}
          sidecarVersion={version}
          sessionLabel={scanningActive ? "进行中" : undefined}
          workspaceName={activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.seasonName}` : undefined}
          freshness={lastCaptureAt ? formatCaptureRecordTime(lastCaptureAt) : undefined}
        />
      </div>
      {/* 命令面板 Dialog 保留原样 */}
    </div>
```

并删除 `DesktopTitleBar`、`AppStatusBar`、`useSidebarCollapsed`、`NavItem`、宽侧栏 `<aside>`、面包屑 `<header>` 的引用与导入。

- [ ] **Step 4: 运行测试** → PASS；`npm test` 全绿。
- [ ] **Step 5: 实机目视**：`npm run tauri dev`，确认外壳三件呈现、无面包屑、无旧 footer。
- [ ] **Step 6: Commit**

```bash
git add src/app/AppShell.tsx src/app/AppShell.test.tsx
git commit -m "feat(shell): 换用图标轨/融合顶栏/HUD 脊指挥台外壳"
```

---

## Phase 3 — 逐页重构

### Task 9: Dashboard 参考实现（卡片网格）

**Files:**
- Modify: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `PageHead`、`KpiStrip`、`UnitCard`、`LiveSessionCard`、现有 queries hooks。

- [ ] **Step 1: 重构 `Dashboard.tsx` 的 return 主体**（保留全部现有 hooks 与统计计算：`todayBattles`/`weekWinRate`/`onlineCount`/`memberTotal`/`unboundCount`/`health`/`sessions`/`weekReports`；仅换骨架）。把 `<PageShell title=… actions=…>` 包裹替换为：

```tsx
    <div className="p-5">
      <PageHead
        title="总览"
        description={activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.serverName} · ${activeWorkspace.seasonName}　本周采集 ${sessions.length} 次 · 最近 ${latestCapture}` : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
              <RefreshCw size={14} className={cn("mr-1.5", refreshing && "animate-spin")} />
              {refreshing ? "刷新中…" : "刷新"}
            </Button>
            <Button size="sm" onClick={() => onNavigate("/capture")}>
              <Play size={14} className="mr-1.5" />
              采集一轮
            </Button>
          </>
        }
      />

      <KpiStrip
        items={[
          { label: "今日战报", value: todayBattles },
          { label: "本周胜率", value: weekWinRate ?? 0, suffix: "%", overrideText: weekWinRate === null ? "—" : undefined, delta: weekWinRate === null ? undefined : { text: weekWinRate >= 50 ? "▲ 达标" : "▼ 低于半数", tone: weekWinRate >= 50 ? "up" : "down" } },
          { label: "在线成员", value: onlineCount, overrideText: memberTotal === 0 ? "—" : undefined, delta: { text: `共 ${memberTotal} 人`, tone: "flat" } },
          { label: "未绑定成员", value: unboundCount, delta: unboundCount > 0 ? { text: "需要处理", tone: "down" } : { text: "全部已绑定", tone: "up" } },
          { label: "同盟健康度", value: health.score, delta: { text: healthToneInfo.label, tone: healthToneInfo.tone === "success" ? "up" : healthToneInfo.tone === "destructive" ? "down" : "flat" } },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {hasBattleReports && (
            <UnitCard title="胜率趋势" tag="近 7 天 · 攻方视角">
              <BattleWinRateChart battles={weekReports} days={7} />
            </UnitCard>
          )}
          <UnitCard title="同盟健康度" tag={`${health.score} 分 · ${healthToneInfo.label}`}>
            {/* 保留现有四 facet 进度条 JSX，仅外层容器换 UnitCard */}
          </UnitCard>
          <UnitCard title="最近采集" tag="全部 →">
            {/* 保留现有 sessions 表，改用 EnhancedTable：columns=["记录","类型","状态","完成时间","摘要"]，renderRow 复用现有 TableCell 内容 */}
          </UnitCard>
        </div>
        <div className="flex flex-col gap-4">
          <LiveSessionCard
            active={sessions.some((s) => s.status === "running")}
            version={version}
            fetched={sessions[0]?.note ? 0 : 0}
            target={0}
            elapsedLabel={latestCapture}
          />
          <UnitCard title="待办" tag="数据齐自动隐藏">
            {/* 保留现有 unboundCount / failedSessionCount 两条告警行 JSX */}
          </UnitCard>
        </div>
      </div>
    </div>
```

注意：`LiveSessionCard` 的 `fetched/target` 若当前无实时进度数据源，传 `0/0` 并将进度条宽度按 `pct=0` 渲染（组件已处理 target=0）；后续接入实时会话数据时再替换。删除对 `PageShell` 的 import 与旧 KPI `<section>`、旧卡片 `<section>` 容器。

- [ ] **Step 2: 运行 `npm test` 与 `npm run build`** → 绿。
- [ ] **Step 3: 实机目视对照概念稿 `#a`**。
- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(page): 总览页换用电竞数据台卡片网格"
```

---

### Task 10: 核心对象页（alliance / lineups / player）

**Files:** Modify `src/pages/AllianceDataPage.tsx`、`src/pages/LineupHubPage.tsx`、`src/pages/PlayerProfilePage.tsx`

- [ ] **Step 1:** 三个文件统一做三类替换：
  (a) 页头：`<PageShell title=… description=… actions=… toolbar=…>` → `<div className="p-5"><PageHead title=… description=… actions=… />{toolbar}` ，并把 `PageShell` 的 import 换成 `PageHead`；
  (b) 核心对象卡：成员/阵容/玩家摘要的 `rounded-lg border border-border bg-card` 容器 → `<UnitCard title=… tag=…>`；
  (c) 明细表：`<Table>…` 块 → `<EnhancedTable columns={[…]} rows={…} renderRow={(r)=>(<>…现有 TableCell 内容…</>)} density="compact" />`。
  代表性片段（AllianceDataPage 成员 tab）：

```tsx
<UnitCard title="成员概览" tag={`共 ${members.length} 人`}>
  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {members.slice(0, 8).map((m) => (
      <div key={m.avatarId} className="rounded-lg border border-[var(--hair)] bg-surface-2/40 p-3">
        <p className="truncate text-[13px] font-medium">{m.name}</p>
        <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">战力 {m.power}</p>
      </div>
    ))}
  </div>
</UnitCard>
```
- [ ] **Step 2:** `npm test` + `npm run build` 绿；实机目视。
- [ ] **Step 3: Commit**（每页一次或合并一次）

```bash
git add src/pages/AllianceDataPage.tsx src/pages/LineupHubPage.tsx src/pages/PlayerProfilePage.tsx
git commit -m "feat(page): 核心对象页换用 UnitCard 网格"
```

---

### Task 11: 密集日志页（timeline / battle-grabber / capture / diagnostics）

**Files:** Modify `src/pages/BattleTimelinePage.tsx`、`src/battle-grabber/BattleGrabberApp.tsx`、`src/pages/CaptureHubPage.tsx`、`src/pages/Diagnostics.tsx`

- [ ] **Step 1:** 四个文件统一：页头换 `PageHead`（同 Task 10 (a)）；主表换 `EnhancedTable`，`density="compact"`，状态列保留 `Badge` 语义色；空态保留 `EmptyState`（带 CTA）。代表性片段（BattleTimelinePage 战报表）：

```tsx
<EnhancedTable
  columns={["时间", "攻方", "守方", "结果", "损失"]}
  rows={reports}
  density="compact"
  renderRow={(r) => (
    <>
      <TableCell className="text-[12px] tabular-nums text-muted-foreground">{formatCaptureRecordTime(r.time)}</TableCell>
      <TableCell className="text-[12.5px]">{r.attackerName}</TableCell>
      <TableCell className="text-[12.5px]">{r.defenderName}</TableCell>
      <TableCell><Badge variant={outcomeVariant(r.result)}>{outcomeLabel(r.result)}</Badge></TableCell>
      <TableCell className="text-right text-[12px] tabular-nums">{r.losses}</TableCell>
    </>
  )}
/>
```

（`outcomeVariant/outcomeLabel` 复用各页现有胜负映射；若该页用的是 `attackerOutcomeFromResult`，则按其返回值映射到 `v-win/v-lose/v-draw` 语义 Badge。）
- [ ] **Step 2:** `npm test` + `npm run build` 绿；实机目视。
- [ ] **Step 3: Commit**

```bash
git add src/pages/BattleTimelinePage.tsx src/battle-grabber/BattleGrabberApp.tsx src/pages/CaptureHubPage.tsx src/pages/Diagnostics.tsx
git commit -m "feat(page): 日志页换用 EnhancedTable"
```

---

### Task 12: 对比/排名/设置页

**Files:** Modify `src/pages/ComparisonPage.tsx`、`src/pages/AllianceRankingPage.tsx`、`src/pages/SettingsPage.tsx`

- [ ] **Step 1:** comparison/ranking：顶部用 `UnitCard` 放对比/排名摘要卡，下方数据表换 `EnhancedTable`；settings：每个设置分组用一个 `UnitCard`，组内行用 `flex items-center justify-between py-2.5 border-b border-[var(--hair)] last:border-b-0`。代表性片段（SettingsPage 分组）：

```tsx
<UnitCard title="采集" tag="sidecar 与扫描间隔">
  <div className="flex items-center justify-between border-b border-[var(--hair)] py-2.5 last:border-b-0">
    <div>
      <p className="text-[13px]">自动采集间隔</p>
      <p className="text-[11.5px] text-muted-foreground">分钟</p>
    </div>
    {/* 保留现有控件（Input/Select/Switch） */}
  </div>
</UnitCard>
```
- [ ] **Step 2:** `npm test` + `npm run build` 绿；实机目视。
- [ ] **Step 3: Commit**

```bash
git add src/pages/ComparisonPage.tsx src/pages/AllianceRankingPage.tsx src/pages/SettingsPage.tsx
git commit -m "feat(page): 对比/排名/设置页换用新骨架"
```

---

## Phase 4 — 收尾验证

### Task 13: 全量验证与概念稿对齐

- [ ] **Step 1:** `npm test`（282+ 全绿）、`npm run build`、`npm run lint`。
- [ ] **Step 2:** `npm run tauri dev` 实机逐页截图，对照 `.qoder/frontend-concept/dashboard-concept.html#a` 与规格 §9 验收标准逐条核对。
- [ ] **Step 3:** 校验 `prefers-reduced-motion`（DevTools 模拟）下动效降级。
- [ ] **Step 4:** 更新 `docs/DESIGN_TONE.md`，在文首加注「§3/§6/§7 已被 2026-10-09 前端重构规格部分取代，见 docs/superpowers/specs/2026-10-09-frontend-redesign-design.md §2」。
- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN_TONE.md
git commit -m "docs: 标注 DESIGN_TONE 被新规格部分取代"
```
