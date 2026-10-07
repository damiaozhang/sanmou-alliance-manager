import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "../components/ThemeToggle";
import { DesktopTitleBar } from "@/components/DesktopTitleBar";
import { AppStatusBar } from "@/components/AppStatusBar";
import { homeNavItem, navSections, ROUTE_PATHS } from "./routes";
import type { WorkspaceRecord } from "../tauri";
import { formatCaptureRecordTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
// 版本号单一数据源：package.json（vite 原生支持 JSON import）
import { version } from "../../package.json";

const NAV_WIDTH = 208;
const NAV_WIDTH_COLLAPSED = 52;
const COLLAPSE_STORAGE_KEY = "ui.sidebarCollapsed";
/** 低于此宽度自动折叠侧栏（回到宽屏时还原用户偏好） */
const AUTO_COLLAPSE_MAX = 1180;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
/** 快捷键展示文案随平台变化，避免在 Windows 上显示 ⌘ */
export const SHORTCUT_LABEL = IS_MAC ? "⌘K" : "Ctrl K";

/**
 * 侧栏折叠状态：用户偏好存 localStorage；窗口过窄时自动折叠且不覆盖偏好。
 * Ctrl/⌘+B 切换（这是数据工具里最省事的常用操作之一）。
 */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.innerWidth <= AUTO_COLLAPSE_MAX) return true;
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_MAX}px)`);
    const onChange = (e: MediaQueryListEvent) => {
      setCollapsed(e.matches ? true : window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}

interface NavItemProps {
  to: string;
  label: string;
  icon: typeof Search;
  collapsed: boolean;
}

/** 导航项：选中态 = 左侧 2px 品牌指示条 + 白字 + 提亮底色（旧版只有背景色，较弱）。 */
function NavItem({ to, label, icon: Icon, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 py-[7px] text-[13px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-indicator/70",
          collapsed ? "justify-center px-0" : "px-4",
          isActive
            ? "bg-nav-active font-medium text-nav-fg-active"
            : "text-nav-fg hover:bg-nav-hover hover:text-nav-fg-active",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-nav-indicator" />
          ) : null}
          <Icon size={15} className="shrink-0" />
          {collapsed ? null : <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

interface PaletteEntry {
  label: string;
  path: string;
  group: string;
}

const PALETTE_ENTRIES: PaletteEntry[] = [
  { label: homeNavItem.label, path: homeNavItem.path, group: "主页" },
  ...navSections.flatMap((section) =>
    section.items.map((item) => ({ label: item.label, path: item.path, group: section.label })),
  ),
];

interface AppShellProps {
  activeWorkspace: WorkspaceRecord | undefined;
  workspaces: WorkspaceRecord[];
  onSelectWorkspace: (id: number) => void;
  scanningActive: boolean;
  hasFailedCapture?: boolean;
  /** 最近一次成功采集的完成时间（ISO），用于顶栏「数据新鲜度」 */
  lastCaptureAt?: string | null;
}

export function AppShell({
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  scanningActive,
  hasFailedCapture,
  lastCaptureAt,
}: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggle } = useSidebarCollapsed();
  const isBattleGrabber = location.pathname === ROUTE_PATHS.battleGrabber;

  // 顶栏标题从导航配置推导；ranking / diagnostics 已不在导航里但路由仍可达，
  // 单独兜底，避免直达时标题渲染成空白（旧版存在此问题）。
  const viewTitle = useMemo(() => {
    if (location.pathname === homeNavItem.path) return homeNavItem.label;
    for (const section of navSections) {
      const found = section.items.find((i) => i.path === location.pathname);
      if (found) return found.label;
    }
    if (location.pathname.startsWith("/player/")) return "玩家档案";
    if (location.pathname === ROUTE_PATHS.ranking) return "玩家排行";
    if (location.pathname === ROUTE_PATHS.diagnostics) return "诊断";
    return "";
  }, [location.pathname]);

  // ── 命令面板（Ctrl/⌘+K）：cmdk 提供过滤打分 / ↑↓ / Enter / ARIA，本层只管开关与跳转 ──
  const [paletteOpen, setPaletteOpen] = useState(false);

  const paletteGroups = useMemo(() => {
    const groups: { label: string; entries: PaletteEntry[] }[] = [];
    for (const entry of PALETTE_ENTRIES) {
      const last = groups[groups.length - 1];
      if (last && last.label === entry.group) last.entries.push(entry);
      else groups.push({ label: entry.group, entries: [entry] });
    }
    return groups;
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commitPalette = useCallback(
    (path: string) => {
      navigate(path);
      setPaletteOpen(false);
    },
    [navigate],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-panel">
      <DesktopTitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── 深色导航轨 ── */}
        <aside
          className="flex shrink-0 flex-col bg-nav-bg transition-[width] duration-200 ease-out"
          style={{ width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH }}
        >
          <div className={cn("flex h-[52px] items-center gap-2.5", collapsed ? "justify-center" : "px-4")}>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-nav-indicator text-[13px] font-medium text-white">
              谋
            </div>
            {collapsed ? null : (
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium leading-tight text-nav-fg-active">Sanmou Ledger</p>
                <p className="truncate text-[10.5px] leading-tight text-nav-fg-muted">
                  {activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.seasonName}` : "未选择工作区"}
                </p>
              </div>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            <NavItem to={homeNavItem.path} label={homeNavItem.label} icon={homeNavItem.icon} collapsed={collapsed} />
            {navSections.map((section) => (
              <div key={section.label}>
                {collapsed ? (
                  <div className="mx-3 my-2 border-t border-white/[0.08]" />
                ) : (
                  <p className="px-4 pb-1 pt-3 text-[10.5px] tracking-[0.06em] text-nav-fg-muted">{section.label}</p>
                )}
                {section.items.map((item) => (
                  <NavItem key={item.path} to={item.path} label={item.label} icon={item.icon} collapsed={collapsed} />
                ))}
              </div>
            ))}
          </nav>

          <div
            className={cn(
              "flex items-center border-t border-white/[0.08] py-2",
              collapsed ? "flex-col gap-1.5" : "justify-between px-4",
            )}
          >
            {collapsed ? null : <p className="text-[11px] text-nav-fg-muted">v{version}</p>}
            <ThemeToggle />
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
              title={`${collapsed ? "展开" : "折叠"}侧栏（Ctrl+B）`}
              className="flex items-center justify-center rounded p-1.5 text-nav-fg-muted transition-colors hover:bg-nav-hover hover:text-nav-fg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-indicator/70"
            >
              {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            </button>
          </div>
        </aside>

        {/* ── 主区 ── */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* 顶栏控制条：面包屑 / 搜索 / 数据新鲜度 / 工作区 / 采集状态 */}
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-card px-5">
            <div className="flex min-w-0 items-center gap-1.5">
              {activeWorkspace ? (
                <>
                  <span className="max-w-[160px] truncate text-[12px] text-muted-foreground">
                    {activeWorkspace.name}
                  </span>
                  <span className="text-muted-foreground/50">›</span>
                </>
              ) : null}
              <h1 className="truncate text-[14px] font-medium">{viewTitle}</h1>
            </div>

            <button
              type="button"
              onClick={openPalette}
              className="ml-auto flex h-8 w-[230px] shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search size={13} className="shrink-0" />
              <span className="truncate">搜索或跳转…</span>
              <kbd className="ml-auto shrink-0 rounded border border-border bg-card px-[5px] py-[1px] font-mono text-[10.5px] leading-[14px] text-muted-foreground">
                {SHORTCUT_LABEL}
              </kbd>
            </button>

            <span
              className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-[3px] text-[11.5px] text-muted-foreground lg:flex"
              title="最近一次采集完成时间"
            >
              <span
                className={cn("size-[6px] rounded-full", lastCaptureAt ? "bg-victory" : "bg-muted-foreground/40")}
              />
              {lastCaptureAt ? formatCaptureRecordTime(lastCaptureAt) : "暂无采集"}
            </span>

            <Select
              value={activeWorkspace?.id ? String(activeWorkspace.id) : ""}
              onValueChange={(v) => onSelectWorkspace(Number(v))}
              disabled={workspaces.length === 0}
            >
              <SelectTrigger
                className="h-8 w-[170px] shrink-0 border-brand-soft bg-brand-soft text-[12px] font-medium text-brand-soft-foreground"
                aria-label="工作区切换"
              >
                <SelectValue placeholder="选择工作区" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name} · {w.seasonName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 状态托盘：采集中 / 采集失败，点击直达采集中心 */}
            {scanningActive ? (
              <NavLink to={ROUTE_PATHS.capture} className="shrink-0" title="查看采集进度">
                <Badge variant="info">采集中</Badge>
              </NavLink>
            ) : null}
            {hasFailedCapture && !scanningActive ? (
              <NavLink to={ROUTE_PATHS.capture} className="shrink-0" title="有采集失败，查看会话历史">
                <Badge variant="destructive">采集失败</Badge>
              </NavLink>
            ) : null}
          </header>

          <div className={cn("flex-1", isBattleGrabber ? "overflow-hidden" : "overflow-auto")}>
            <div className={cn("page-enter", isBattleGrabber && "h-full")}>
              <Outlet />
            </div>
          </div>
          <AppStatusBar
            workspaceName={activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.seasonName}` : undefined}
            scanningActive={scanningActive}
            hasFailedCapture={hasFailedCapture}
          />
        </main>
      </div>

      {/* ── 命令面板（cmdk + Dialog：焦点陷阱、Esc、滚动锁定由 Radix 承担） ── */}
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent
          className="top-[12vh] max-w-[520px] translate-y-0 gap-0 overflow-hidden rounded-xl border-border bg-popover p-0 shadow-elevated"
          aria-label="命令面板"
        >
          <DialogTitle className="sr-only">命令面板</DialogTitle>
          <Command loop>
            <CommandInput placeholder="输入以跳转页面…" />
            <CommandList>
              <CommandEmpty>没有匹配的页面</CommandEmpty>
              {paletteGroups.map((group) => (
                <CommandGroup key={group.label} heading={group.label}>
                  {group.entries.map((entry) => (
                    <CommandItem
                      key={entry.path}
                      value={entry.label}
                      keywords={[entry.group]}
                      onSelect={() => commitPalette(entry.path)}
                    >
                      <span className="text-[10.5px] text-muted-foreground">{entry.group}</span>
                      <span className="truncate font-medium">{entry.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
