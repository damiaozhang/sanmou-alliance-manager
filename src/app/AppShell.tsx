import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppIconRail } from "@/components/AppIconRail";
import { AppTopBar } from "@/components/AppTopBar";
import { HudStatusBar } from "@/components/HudStatusBar";
import { WindowControls, useWindowDragRegion } from "@/components/WindowChrome";
import { homeNavItem, navSections, ROUTE_PATHS } from "./routes";
import type { WorkspaceRecord } from "../tauri";
import { formatCaptureRecordTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
// 版本号单一数据源：package.json（vite 原生支持 JSON import）；sidecar 与本包版本锁定一致
import { version } from "../../package.json";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
/** 快捷键展示文案随平台变化，避免在 Windows 上显示 ⌘ */
export const SHORTCUT_LABEL = IS_MAC ? "⌘K" : "Ctrl K";

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
  /** 采集 sidecar 是否在线（来自 collector 状态查询） */
  sidecarOnline?: boolean;
  /** 最近一次成功采集的完成时间（ISO），用于 HUD「数据新鲜度」 */
  lastCaptureAt?: string | null;
}

export function AppShell({
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  scanningActive,
  hasFailedCapture,
  sidecarOnline = false,
  lastCaptureAt,
}: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const onTopBarPointerDown = useWindowDragRegion();
  const isBattleGrabber = location.pathname === ROUTE_PATHS.battleGrabber;

  // 顶栏标题从导航配置推导；ranking / diagnostics 已不在导航里但路由仍可达，
  // 单独兜底，避免直达时标题渲染成空白。
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

  const workspaceSwitcher = (
    <Select
      value={activeWorkspace?.id ? String(activeWorkspace.id) : ""}
      onValueChange={(v) => onSelectWorkspace(Number(v))}
      disabled={workspaces.length === 0}
    >
      <SelectTrigger
        className="h-[26px] w-[168px] shrink-0 rounded-lg border-[var(--hair)] bg-surface-1 text-[12px] font-medium"
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
  );

  return (
    <div
      className="grid h-screen grid-cols-[56px_1fr] grid-rows-[40px_1fr_34px] overflow-hidden bg-surface-0"
      style={{ gridTemplateAreas: '"rail topbar" "rail main" "rail hud"' }}
    >
      {/* ── 图标轨（常驻收起，不再需要宽侧栏折叠） ── */}
      <div style={{ gridArea: "rail" }} className="flex min-h-0">
        <AppIconRail />
      </div>

      {/* ── 融合顶栏：上下文标题 + 工作区切换 + 搜索；整条兼作窗口拖拽区 ── */}
      <div style={{ gridArea: "topbar" }} className="flex min-w-0" onPointerDown={onTopBarPointerDown}>
        <AppTopBar
          viewTitle={viewTitle}
          workspaceName={activeWorkspace?.name}
          onOpenPalette={openPalette}
          shortcutLabel={SHORTCUT_LABEL}
          workspaceSwitcher={workspaceSwitcher}
        />
        <WindowControls />
      </div>

      {/* ── 主区 ── */}
      <main style={{ gridArea: "main" }} className={cn("min-h-0", isBattleGrabber ? "overflow-hidden" : "overflow-auto")}>
        <div className={cn("page-enter", isBattleGrabber && "h-full")}>
          <Outlet />
        </div>
      </main>

      {/* ── HUD 状态脊 ── */}
      <div style={{ gridArea: "hud" }} className="flex min-w-0">
        <HudStatusBar
          sidecarOnline={sidecarOnline}
          sidecarVersion={version}
          sessionLabel={scanningActive ? "进行中" : undefined}
          workspaceName={activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.seasonName}` : undefined}
          freshness={lastCaptureAt ? formatCaptureRecordTime(lastCaptureAt) : undefined}
          alertCount={hasFailedCapture && !scanningActive ? 1 : undefined}
        />
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
