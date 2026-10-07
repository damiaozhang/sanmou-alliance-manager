import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Download, Radio, RefreshCcw, ScrollText, ShieldEllipsis, Swords, Unplug } from "lucide-react";

import type { AllianceLineupSort, JsonRecord } from "../types";
import { asNumber, csvCell, downloadTextFile, formatFileTimestamp, getObjectField } from "../utils/helpers";
import {
  formatCount, formatPercent, formatAverageCount, formatAverageEvolution, formatAverageHeroLevel,
  formatTotalMerit, formatRemainingRate, formatOwnLossRate, formatEnemyLossRate, formatLossExchangeRatio, formatTime,
} from "../utils/format";
import {
  getAllianceSideAllianceName, getAllianceSidePlayerName, getAllianceSideFormationName, getAllianceSideLineupLabel,
  getAllianceSideHeroLevels, getAllianceSideMerit, getAllianceSideTroopTotals,
  getAllianceRecordKey, getAllianceBattleTime, getAllianceWinnerLabel,
  allianceWinRate, getAllianceFilterOptions,
  buildAllianceLineupStats, buildAllianceMatchupStats, buildAllianceStreakStats,
  sortAllianceLineupStats, getAllianceMatchupView, buildAllianceCsv,
  nextAllianceLineupSort,
  getAllianceContinuousBattleCount, getAllianceContinuousWinBattleNum, getAllianceContinuousChainMerit,
} from "../utils/alliance";
import { AllianceSideCell } from "../components/alliance/AllianceSideCell";
import { MetricCard } from "@/components/MetricCard";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatErrorMessage } from "@/lib/format";

type AppendClientLog = (level: "info" | "warn" | "error", message: string) => void;

// 阵容排序交互未接线（S0 清理）：固定按胜率降序，与原半成品默认值保持一致。
const DEFAULT_ALLIANCE_LINEUP_SORT: AllianceLineupSort = { key: "winRate", direction: "desc" };
// 阶段3b：同盟交战详情改 DataTable 客户端分页 + 虚拟化，避免全量渲染
const ALLIANCE_RECORDS_PAGE_SIZE = 50;

function buildStructuredAllianceCsv(records: JsonRecord[]): string {
  const header = [
    "战斗Key", "地点", "时间", "结果", "胜方",
    "攻方同盟", "攻方玩家", "攻方阵型", "攻方阵容", "攻方等级", "攻方武勋", "攻方剩余", "攻方原始兵力", "攻方伤兵", "攻方阵亡",
    "守方同盟", "守方玩家", "守方阵型", "守方阵容", "守方等级", "守方武勋", "守方剩余", "守方原始兵力", "守方伤兵", "守方阵亡",
    "回合", "父战报", "连战场次", "连战武勋",
  ];
  const rows = records.map((record, index) => {
    const at = getAllianceSideTroopTotals(record, "attack");
    const dt = getAllianceSideTroopTotals(record, "defend");
    return [
      getAllianceRecordKey(record, index), getObjectField(record, "territory", "location", "coord"),
      getAllianceBattleTime(record), getObjectField(record, "result", "battleResult") || "交战", getAllianceWinnerLabel(record),
      getAllianceSideAllianceName(record, "attack"), getAllianceSidePlayerName(record, "attack"),
      getAllianceSideFormationName(record, "attack"), getAllianceSideLineupLabel(record, "attack"),
      getAllianceSideHeroLevels(record, "attack").join("/"), getAllianceSideMerit(record, "attack"),
      at.remainingTroops, at.originTroops, at.wounded, at.dead,
      getAllianceSideAllianceName(record, "defend"), getAllianceSidePlayerName(record, "defend"),
      getAllianceSideFormationName(record, "defend"), getAllianceSideLineupLabel(record, "defend"),
      getAllianceSideHeroLevels(record, "defend").join("/"), getAllianceSideMerit(record, "defend"),
      dt.remainingTroops, dt.originTroops, dt.wounded, dt.dead,
      asNumber(record["endRound"]) ?? "", getObjectField(record, "parentBattleId"),
      Math.max(getAllianceContinuousBattleCount(record), getAllianceContinuousWinBattleNum(record)) || "",
      getAllianceContinuousChainMerit(record) || "",
    ];
  });
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

export type AllianceBattleTabProps = {
  allianceRecords: JsonRecord[];
  allianceCount: number;
  scanWorkspace: string;
  allianceNameFilter: string;
  setAllianceNameFilter: (v: string) => void;
  allianceMatchupFilterKey: string;
  setAllianceMatchupFilterKey: (v: string) => void;
  busy: boolean;
  connectionReady: boolean;
  desktopRuntime: boolean;
  appendClientLog: AppendClientLog;
  startAllianceListener: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
};

export function AllianceBattleTab(props: AllianceBattleTabProps): JSX.Element {
  const {
    allianceRecords, allianceCount, scanWorkspace, allianceNameFilter, setAllianceNameFilter,
    allianceMatchupFilterKey, setAllianceMatchupFilterKey,
    busy, connectionReady, desktopRuntime, appendClientLog,
    startAllianceListener, disconnect, refreshSnapshot,
  } = props;

  const allianceFilterOptions = useMemo(() => getAllianceFilterOptions(allianceRecords), [allianceRecords]);
  const [allianceRecordsPage, setAllianceRecordsPage] = useState(1);
  const allianceRecordColumns = useMemo<DataTableColumn<JsonRecord>[]>(() => {
    const globalIndex = (index: number) => (allianceRecordsPage - 1) * ALLIANCE_RECORDS_PAGE_SIZE + index;
    return [
      { key: "no", header: "#", width: "48px", cellClassName: "text-muted-foreground", render: (_r, i) => globalIndex(i) + 1 },
      { key: "location", header: "地点", width: "90px", render: (r) => getObjectField(r, "territory", "location", "coord") || "-" },
      { key: "time", header: "时间", width: "140px", cellClassName: "text-muted-foreground", render: (r) => formatTime(getObjectField(r, "battleTime", "battle_time", "createTime")) },
      {
        key: "attack", header: "攻方", width: "minmax(160px,1fr)", cellClassName: "text-side-ally overflow-visible",
        render: (r) => <AllianceSideCell record={r} prefix="attack" />,
      },
      {
        key: "result", header: "结果", width: "110px", cellClassName: "text-primary overflow-visible",
        render: (r) => (
          <>
            <p>{getObjectField(r, "result", "battleResult") || "交战"}</p>
            {Math.max(getAllianceContinuousBattleCount(r), getAllianceContinuousWinBattleNum(r)) > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">连战{formatCount(Math.max(getAllianceContinuousBattleCount(r), getAllianceContinuousWinBattleNum(r)))} 武勋{formatCount(getAllianceContinuousChainMerit(r))}</p>
            )}
          </>
        ),
      },
      {
        key: "defend", header: "守方", width: "minmax(160px,1fr)", cellClassName: "text-side-enemy overflow-visible",
        render: (r) => <AllianceSideCell record={r} prefix="defend" />,
      },
    ];
  }, [allianceRecordsPage]);
  const pagedAllianceRecords = useMemo(
    () => allianceRecords.slice((allianceRecordsPage - 1) * ALLIANCE_RECORDS_PAGE_SIZE, allianceRecordsPage * ALLIANCE_RECORDS_PAGE_SIZE),
    [allianceRecords, allianceRecordsPage],
  );
  const [allianceLineupSort, setAllianceLineupSort] = useState<AllianceLineupSort>(DEFAULT_ALLIANCE_LINEUP_SORT);
  const allianceLineupStats = useMemo(() => sortAllianceLineupStats(buildAllianceLineupStats(allianceRecords, allianceNameFilter), allianceLineupSort), [allianceNameFilter, allianceLineupSort, allianceRecords]);
  const allianceMatchupStats = useMemo(() => buildAllianceMatchupStats(allianceRecords, allianceNameFilter), [allianceNameFilter, allianceRecords]);
  const allianceStreakStats = useMemo(() => buildAllianceStreakStats(allianceRecords, allianceNameFilter), [allianceNameFilter, allianceRecords]);
  const allianceLineupOptions = useMemo(() => allianceLineupStats.filter((s) => s.key.trim()).map((s) => ({ key: s.key, label: s.label || "未知阵容" })), [allianceLineupStats]);
  const visibleAllianceMatchups = useMemo(() => {
    const filtered = allianceMatchupFilterKey ? allianceMatchupStats.filter((s) => s.leftKey === allianceMatchupFilterKey || s.rightKey === allianceMatchupFilterKey) : allianceMatchupStats;
    return filtered.slice(0, 50);
  }, [allianceMatchupFilterKey, allianceMatchupStats]);

  const allianceBlockCount = useMemo(
    () => allianceRecords.filter((r) => getObjectField(r, "recordType") === "block").length,
    [allianceRecords],
  );
  const allianceChildCount = useMemo(
    () => allianceRecords.filter((r) => getObjectField(r, "recordType") === "child").length,
    [allianceRecords],
  );

  useEffect(() => {
    if (allianceMatchupFilterKey && !allianceLineupOptions.some((o) => o.key === allianceMatchupFilterKey)) setAllianceMatchupFilterKey("");
  }, [allianceLineupOptions, allianceMatchupFilterKey, setAllianceMatchupFilterKey]);
  useEffect(() => {
    if (allianceNameFilter && !allianceFilterOptions.includes(allianceNameFilter)) setAllianceNameFilter("");
  }, [allianceFilterOptions, allianceNameFilter, setAllianceNameFilter]);

  async function exportAllianceCsv(): Promise<void> {
    if (allianceRecords.length === 0) { appendClientLog("warn", "暂无同盟战报可导出。"); return; }
    const csv = buildAllianceCsv(allianceRecords);
    const filename = `alliance_battles_${formatFileTimestamp(new Date())}.csv`;
    try {
      if (desktopRuntime) await invoke("battle_grabber_write_text_export", { filename, contents: csv });
      else downloadTextFile(filename, csv, "text/csv;charset=utf-8");
      appendClientLog("info", `同盟战报 CSV 已导出: ${filename}`);
    } catch (e) { appendClientLog("error", `同盟战报 CSV 导出失败: ${formatErrorMessage(e)}`); }
  }

  async function exportStructuredAllianceCsv(): Promise<void> {
    if (allianceRecords.length === 0) { appendClientLog("warn", "暂无结构化战报可导出。"); return; }
    const csv = buildStructuredAllianceCsv(allianceRecords);
    const wp = scanWorkspace ? `${scanWorkspace}_` : "";
    const filename = `structured_alliance_battles_${wp}${formatFileTimestamp(new Date())}.csv`;
    try {
      if (desktopRuntime) await invoke("battle_grabber_write_text_export", { filename, contents: csv });
      else downloadTextFile(filename, csv, "text/csv;charset=utf-8");
      appendClientLog("info", `结构化战报 CSV 已导出: ${filename}`);
    } catch (e) { appendClientLog("error", `结构化战报 CSV 导出失败: ${formatErrorMessage(e)}`); }
  }

  return (
    <section className="min-w-0 space-y-4">
      <CollapsibleCard title="同盟协议监听" icon={ShieldEllipsis}>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="战报组" value={formatCount(allianceBlockCount)} tone="primary" />
          <MetricCard label="子战报" value={formatCount(allianceChildCount)} tone="victory" />
          <MetricCard label="总记录" value={formatCount(allianceCount)} tone="defeat" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={connectionReady ? "outline" : "default"} onClick={() => void startAllianceListener()} disabled={busy || connectionReady}><Radio className="mr-2 h-4 w-4" />{connectionReady ? "监听中" : "开始监听"}</Button>
          <Button variant={connectionReady ? "destructive" : "outline"} onClick={() => void (connectionReady ? disconnect() : refreshSnapshot())} disabled={busy}>{connectionReady ? <Unplug className="mr-2 h-4 w-4" /> : <RefreshCcw className="mr-2 h-4 w-4" />}{connectionReady ? "停止监听" : "刷新"}</Button>
          <Button variant="outline" onClick={() => void exportAllianceCsv()} disabled={allianceRecords.length === 0}><Download className="mr-2 h-4 w-4" />导出 CSV</Button>
        </div>
      </CollapsibleCard>
      <CollapsibleCard title="阵容表现" icon={BarChart3} collapsible defaultOpen={false}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex min-w-[240px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-caption text-muted-foreground">同盟</span>
            <Select value={allianceNameFilter || "__all__"} onValueChange={(v) => { setAllianceNameFilter(v === "__all__" ? "" : v); setAllianceMatchupFilterKey(""); }}>
              <SelectTrigger><SelectValue placeholder="全部同盟" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部同盟</SelectItem>
                {allianceFilterOptions.filter((n) => n.trim()).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto pb-1">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="w-8 px-2 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">阵容</th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "battles"))}>
                    出场{allianceLineupSort.key === "battles" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-24 px-2 py-2 text-right text-xs font-medium text-muted-foreground">胜/负/平</th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "winRate"))}>
                    胜率{allianceLineupSort.key === "winRate" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "lossExchangeRatio"))}>
                    战损比{allianceLineupSort.key === "lossExchangeRatio" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "merit"))}>
                    武勋{allianceLineupSort.key === "merit" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "averageEvolution"))}>
                    红度{allianceLineupSort.key === "averageEvolution" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "averageHeroLevel"))}>
                    等级{allianceLineupSort.key === "averageHeroLevel" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">攻/守</th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">剩余</th>
                <th className="w-20 px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setAllianceLineupSort((c) => nextAllianceLineupSort(c, "averageCasualties"))}>
                    伤亡{allianceLineupSort.key === "averageCasualties" ? (allianceLineupSort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">我损</th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">敌损</th>
              </tr>
            </thead>
            <tbody>
              {allianceLineupStats.length === 0 && <tr><td colSpan={14} className="px-2 py-8 text-center text-muted-foreground">暂无阵容统计</td></tr>}
              {allianceLineupStats.slice(0, 18).map((s, i) => (
                <tr key={s.key} className="border-b hover:bg-muted/50">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="truncate px-2 py-2 font-medium">{s.label || "未知阵容"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.battles)}</td>
                  <td className="px-2 py-2 text-right tabular-nums"><span className="text-victory">{formatCount(s.wins)}</span><span className="text-muted-foreground">/</span><span className="text-defeat">{formatCount(s.losses)}</span><span className="text-muted-foreground">/</span><span className="text-primary">{formatCount(s.draws)}</span></td>
                  <td className="px-2 py-2 text-right tabular-nums text-side-ally">{formatPercent(allianceWinRate(s.wins, s.losses, s.draws))}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-primary">{formatLossExchangeRatio(s.totalDead, s.totalWounded, s.totalOriginTroops, s.totalEnemyDead, s.totalEnemyWounded, s.totalEnemyOriginTroops)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-victory">{formatTotalMerit(s.totalMerit ?? 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-primary">{formatAverageEvolution(s.totalEvolution, s.evolutionCount)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatAverageHeroLevel(s.totalHeroLevel ?? 0, s.heroLevelCount ?? 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.attackBattles)}/{formatCount(s.defendBattles)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatRemainingRate(s.totalRemainingTroops, s.totalOriginTroops)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatAverageCount(s.totalWounded, s.battles)}伤/{formatAverageCount(s.totalDead, s.battles)}亡</td>
                  <td className="px-2 py-2 text-right tabular-nums text-defeat">{formatOwnLossRate(s.totalDead, s.totalWounded, s.totalOriginTroops)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-side-ally">{formatEnemyLossRate(s.totalEnemyDead, s.totalEnemyWounded, s.totalEnemyOriginTroops)}</td>
                </tr>
              ))}
              </tbody>
            </table>
            {allianceLineupStats.length > 18 && (
              <p className="mt-2 text-caption text-muted-foreground">
                共 {allianceLineupStats.length} 条阵容 · 仅显示前 18 条
              </p>
            )}
          </div>
        </CollapsibleCard>
      <CollapsibleCard title="连串阵容榜" icon={BarChart3} collapsible defaultOpen={false}>
        <div className="overflow-x-auto pb-1">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="w-8 px-2 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">阵容</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">玩家</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">同盟</th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">连战</th>
                <th className="w-20 px-2 py-2 text-right text-xs font-medium text-muted-foreground">武勋</th>
              </tr>
            </thead>
            <tbody>
              {allianceStreakStats.length === 0 && <tr><td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">暂无连串阵容</td></tr>}
              {allianceStreakStats.slice(0, 20).map((s, i) => (
                <tr key={s.key} className="border-b hover:bg-muted/50">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="truncate px-2 py-2 font-medium">{s.label}</td>
                  <td className="px-2 py-2">{s.player || "-"}</td>
                  <td className="px-2 py-2">{s.alliance || "-"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-primary">{formatCount(Math.max(s.winBattleNum, s.battleCount))}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-victory">{formatCount(s.chainMerit)}</td>
                </tr>
              ))}
              </tbody>
            </table>
            {allianceStreakStats.length > 20 && (
              <p className="mt-2 text-caption text-muted-foreground">
                共 {allianceStreakStats.length} 条连串阵容 · 仅显示前 20 条
              </p>
            )}
          </div>
        </CollapsibleCard>
      <CollapsibleCard title="阵容对阵" icon={Swords} collapsible defaultOpen={false}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-caption text-muted-foreground">目标阵容</span>
            <Select value={allianceMatchupFilterKey || "__all__"} onValueChange={(v) => setAllianceMatchupFilterKey(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="全部阵容" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部阵容</SelectItem>
                {allianceLineupOptions.filter((o) => o.key.trim()).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="text-caption text-muted-foreground">{formatCount(visibleAllianceMatchups.length)} 组</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">阵容</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">对阵</th>
                <th className="w-14 px-2 py-2 text-right text-xs font-medium text-muted-foreground">场次</th>
                <th className="w-24 px-2 py-2 text-right text-xs font-medium text-muted-foreground">胜/负/平</th>
                <th className="w-16 px-2 py-2 text-right text-xs font-medium text-muted-foreground">胜率</th>
              </tr>
            </thead>
            <tbody>
              {visibleAllianceMatchups.length === 0 && <tr><td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">暂无对阵统计</td></tr>}
              {visibleAllianceMatchups.map((s) => {
                const v = getAllianceMatchupView(s, allianceMatchupFilterKey);
                return (
                  <tr key={v.key} className="border-b hover:bg-muted/50">
                    <td className="truncate px-2 py-2 font-medium">{v.primaryLabel}</td>
                    <td className="truncate px-2 py-2 text-muted-foreground">{v.opponentLabel}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatCount(v.battles)}</td>
                    <td className="px-2 py-2 text-right tabular-nums"><span className="text-victory">{formatCount(v.wins)}</span><span className="text-muted-foreground">/</span><span className="text-defeat">{formatCount(v.losses)}</span><span className="text-muted-foreground">/</span><span className="text-primary">{formatCount(v.draws)}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums text-side-ally">{formatPercent(v.winRate)}</td>
                  </tr>
                );
              })}
              </tbody>
            </table>
            {(() => {
              const total = allianceMatchupFilterKey
                ? allianceMatchupStats.filter((s) => s.leftKey === allianceMatchupFilterKey || s.rightKey === allianceMatchupFilterKey)
                : allianceMatchupStats;
              return total.length > 50 ? (
                <p className="mt-2 text-caption text-muted-foreground">
                  共 {total.length} 组对阵 · 仅显示前 50 条
                </p>
              ) : null;
            })()}
          </div>
        </CollapsibleCard>
      <CollapsibleCard title="同盟交战详情" icon={ScrollText}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-caption text-muted-foreground">{formatCount(allianceRecords.length)} 条</span>
          <Button variant="outline" size="sm" onClick={() => void exportStructuredAllianceCsv()} disabled={allianceRecords.length === 0}><Download className="mr-2 h-4 w-4" />批量导出 CSV</Button>
        </div>
        <div className="overflow-x-auto">
          <DataTable
            rows={pagedAllianceRecords}
            total={allianceRecords.length}
            page={allianceRecordsPage}
            pageSize={ALLIANCE_RECORDS_PAGE_SIZE}
            onPageChange={setAllianceRecordsPage}
            columns={allianceRecordColumns}
            rowKey={(record, index) => getAllianceRecordKey(record, (allianceRecordsPage - 1) * ALLIANCE_RECORDS_PAGE_SIZE + index)}
            rowHeight={56}
            maxHeight={480}
            emptyTitle="暂无同盟协议记录"
          />
        </div>
      </CollapsibleCard>
    </section>
  );
}
