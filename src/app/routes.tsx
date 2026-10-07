import { lazy } from "react";
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Clock3,
  Play,
  Settings2,
  Swords,
  UsersRound,
} from "lucide-react";

// 路径常量表
export const ROUTE_PATHS = {
  dashboard: "/dashboard",
  capture: "/capture",
  alliance: "/alliance",
  battleGrabber: "/battle-grabber",
  lineups: "/lineups",
  ranking: "/ranking",
  comparison: "/comparison",
  timeline: "/timeline",
  diagnostics: "/diagnostics",
  settings: "/settings",
} as const;

// 旧 ViewKey 键 → 新路径映射（含别名 battles；playerProfile 无参数，重定向到同盟数据页；
// autoCapture 自 S2-2 起合并入采集中心，旧 hash 一次性重定向到 /capture；
// winRate 自 S2-3 起合并入阵容中心，旧 hash 一次性重定向到 /lineups；
// binding 自 S2-4 起降为同盟数据页 tab，旧 hash 一次性重定向到 /alliance）
export const LEGACY_VIEW_TO_PATH: Record<string, string> = {
  dashboard: ROUTE_PATHS.dashboard,
  capture: ROUTE_PATHS.capture,
  alliance: ROUTE_PATHS.alliance,
  battleGrabber: ROUTE_PATHS.battleGrabber,
  battles: ROUTE_PATHS.battleGrabber,
  lineups: ROUTE_PATHS.lineups,
  ranking: ROUTE_PATHS.ranking,
  binding: ROUTE_PATHS.alliance,
  comparison: ROUTE_PATHS.comparison,
  timeline: ROUTE_PATHS.timeline,
  diagnostics: ROUTE_PATHS.diagnostics,
  playerProfile: ROUTE_PATHS.alliance,
  autoCapture: ROUTE_PATHS.capture,
  winRate: ROUTE_PATHS.lineups,
};

// 旧 hash（#dashboard / #battles 等）→ 新路径；新格式（#/...）、空 hash 或未知键返回 null
export function resolveLegacyHash(hash: string): string | null {
  const key = hash.replace(/^#/, "");
  if (!key || key.startsWith("/")) return null;
  return LEGACY_VIEW_TO_PATH[key] ?? null;
}

/**
 * 侧栏导航配置（重设计 2026-09-21）。
 *
 * 相较旧版的三点变化：
 * 1. 「总览」独立置顶（homeNavItem），不再与功能项抢同一层级；
 * 2. 分组依据改为「采什么 → 存什么 → 看出什么」：采集 / 数据 / 洞察 / 系统；
 * 3. 命名去掉纯动词——「数据采集」→「同盟快照」、「战报采集」→「战报抓取」，
 *    原名两个都叫「采集」，加上顶栏两个状态 Badge 共 3 个入口指向同一概念，用户无法区分。
 *
 * I6 收敛（保留）：玩家排行降为同盟数据 tab（ranking 路由保留兼容旧链接，导航不再展示）；
 * 诊断移入设置页（diagnostics 路由保留兼容，导航不再展示）。
 */
export const homeNavItem = {
  path: ROUTE_PATHS.dashboard,
  label: "总览",
  icon: Activity,
};

export const navSections = [
  {
    label: "采集",
    items: [
      { path: ROUTE_PATHS.capture, label: "同盟快照", icon: Play },
      { path: ROUTE_PATHS.battleGrabber, label: "战报抓取", icon: Swords },
    ],
  },
  {
    label: "数据",
    items: [
      { path: ROUTE_PATHS.alliance, label: "同盟数据", icon: UsersRound },
      { path: ROUTE_PATHS.lineups, label: "阵容中心", icon: BookOpenCheck },
    ],
  },
  {
    label: "洞察",
    items: [
      { path: ROUTE_PATHS.comparison, label: "时间对比", icon: BarChart3 },
      { path: ROUTE_PATHS.timeline, label: "战报时间线", icon: Clock3 },
    ],
  },
  {
    label: "系统",
    items: [
      { path: ROUTE_PATHS.settings, label: "设置", icon: Settings2 },
    ],
  },
];

// 11 个页面全部 lazy 化；页面均为命名导出，用 .then 包装为默认导出
export const LazyDashboard = lazy(() =>
  import("../pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
export const LazyCaptureHubPage = lazy(() =>
  import("../pages/CaptureHubPage").then((m) => ({ default: m.CaptureHubPage })),
);
export const LazyAllianceDataPage = lazy(() =>
  import("../pages/AllianceDataPage").then((m) => ({ default: m.AllianceDataPage })),
);
export const LazyBattleGrabberApp = lazy(() =>
  import("../battle-grabber/BattleGrabberApp").then((m) => ({ default: m.BattleGrabberApp })),
);
export const LazyLineupHubPage = lazy(() =>
  import("../pages/LineupHubPage").then((m) => ({ default: m.LineupHubPage })),
);
export const LazyAllianceRankingPage = lazy(() =>
  import("../pages/AllianceRankingPage").then((m) => ({ default: m.AllianceRankingPage })),
);
export const LazyComparisonPage = lazy(() =>
  import("../pages/ComparisonPage").then((m) => ({ default: m.ComparisonPage })),
);
export const LazyBattleTimelinePage = lazy(() =>
  import("../pages/BattleTimelinePage").then((m) => ({ default: m.BattleTimelinePage })),
);
export const LazyDiagnostics = lazy(() =>
  import("../pages/Diagnostics").then((m) => ({ default: m.Diagnostics })),
);
export const LazySettingsPage = lazy(() =>
  import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
export const LazyPlayerProfilePage = lazy(() =>
  import("../pages/PlayerProfilePage").then((m) => ({ default: m.PlayerProfileRoute })),
);
