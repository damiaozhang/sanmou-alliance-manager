import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { BattleReportRow } from "../tauri";
import { dateKey } from "@/lib/dates";
import { useAppData, useBattleReportsPaged } from "@/app/queries";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { useExportActions } from "@/features/export/useExportActions";
import { resultBadge, attackerOutcomeFromResult } from "@/lib/labels";
import { summarizeWinRate, type WinRateOutcome } from "@/lib/winrate";
import { formatErrorMessage } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BattleWinRateChart } from "@/components/charts";
import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SuspenseFallback } from "@/components/SuspenseFallback";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { PageHead } from "@/components/PageHead";
import { UnitCard } from "@/components/UnitCard";
import { useUrlState } from "@/hooks/useUrlState";

function timeOnly(value: string): string {
  const t = value.length > 11 ? value.slice(11, 16) : value;
  return t || value;
}

// 空态用模块级常量，保证引用稳定
const EMPTY_BATTLE_ROWS: BattleReportRow[] = [];

type TimelineItem = { time: string; result: string; enemy: string; lineup: string; code: string };

interface DayGroup {
  date: string;
  items: TimelineItem[];
  wins: number;
  losses: number;
  draws: number;
}

function TimelineDay({
  group,
  defaultOpen,
  onExportBattleReport,
}: {
  group: DayGroup;
  defaultOpen: boolean;
  onExportBattleReport: (battleCode: string, format: "json" | "html") => void | Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group overflow-hidden border-b border-border last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60">
        <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span className="font-mono text-[12px] font-medium tabular-nums">{group.date}</span>
        <span className="text-[11.5px] text-muted-foreground">{group.items.length} 场</span>
        <span className="ml-auto text-[11.5px] tabular-nums">
          <span className="text-victory">{group.wins} 胜</span>
          <span className="mx-2 text-muted-foreground/50">/</span>
          <span className="text-defeat">{group.losses} 负</span>
          {group.draws > 0 ? <span className="ml-2 text-draw">{group.draws} 平</span> : null}
        </span>
      </summary>
      <div className="border-t border-border/70">
        <Table dense>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>对手</TableHead>
              <TableHead>阵容</TableHead>
              <TableHead>战报码</TableHead>
              <TableHead className="w-[88px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.items.map((item, index) => {
              const badge = resultBadge(item.result);
              return (
                <TableRow key={`${group.date}-${index}`}>
                  <TableCell className="font-mono text-[11.5px] tabular-nums">{timeOnly(item.time)}</TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={item.enemy}>
                    {item.enemy}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate" title={item.lineup}>
                    {item.lineup}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{item.code || "—"}</TableCell>
                  <TableCell>
                    {item.code ? (
                      <ExportMenu
                        triggerLabel="导出"
                        items={[
                          { label: "JSON", onSelect: () => onExportBattleReport(item.code, "json") },
                          { label: "HTML", onSelect: () => onExportBattleReport(item.code, "html") },
                        ]}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}

export const BattleTimelinePage = React.memo(function BattleTimelinePage() {
  // 阶段4：页面自取数据与导出动作，不再接收 App 下钻 props
  const { workspaceId } = useActiveWorkspaceContext();
  const { lineupAnalysis } = useAppData(workspaceId);
  const { exportBattleReport: onExportBattleReport } = useExportActions();
  const [dateFrom, setDateFrom] = useUrlState("from");
  const [dateTo, setDateTo] = useUrlState("to");

  // 非法日期（如手输 "202" / "2025/9/1"）会让 new Date(...).toISOString() 抛
  // RangeError，进而整站被 ErrorBoundary 接管。先正则校验 + try/catch 兜底。
  const dateError = useMemo(() => {
    const bad: string[] = [];
    for (const v of [dateFrom, dateTo]) {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad.push(v);
    }
    return bad.length ? `日期格式不正确：${bad.join("、")}（应为 YYYY-MM-DD）` : null;
  }, [dateFrom, dateTo]);

  const safeISO = (v: string): string | null => {
    try {
      const d = new Date(`${v}T00:00:00`);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch {
      return null;
    }
  };

  // 阶段3b：战报改走 get_battle_reports_paged（服务端时间过滤，RFC3339 [from, to)，time DESC）
  const fromISO = useMemo(() => (dateError || !dateFrom ? null : safeISO(dateFrom)), [dateFrom, dateError]);
  const toISO = useMemo(() => {
    if (dateError || !dateTo) return null;
    const start = safeISO(dateTo);
    return start ? new Date(new Date(start).getTime() + 86_400_000).toISOString() : null;
  }, [dateTo, dateError]);
  const reportsQuery = useBattleReportsPaged(workspaceId, { from: fromISO, to: toISO, limit: 1000, offset: 0 });
  const reportRows = reportsQuery.data?.rows ?? EMPTY_BATTLE_ROWS;

  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const r of reportRows) {
      items.push({
        time: r.time,
        result: r.result,
        enemy: r.enemy || r.enemyPlayer || "-",
        lineup: r.lineup || "-",
        code: r.battleCode,
      });
    }
    if (items.length === 0) {
      // 无入库战报时退到阵容对阵记录（内存数据，客户端时间过滤）
      for (const m of lineupAnalysis.matchups) {
        if (!m.battleTime) continue;
        const dk = dateKey(m.battleTime);
        if (dateFrom && dk < dateFrom) continue;
        if (dateTo && dk > dateTo) continue;
        // 行内阵容是攻击方阵容，直接以 outcome（攻击方视角）生成展示标签，
        // 避免把「守方胜」交给 resultBadge 子串匹配误判为胜。
        const resultLabel =
          m.outcome === "win" ? "胜" : m.outcome === "loss" ? "负" : m.outcome === "draw" ? "平" : "交战";
        items.push({
          time: m.battleTime,
          result: resultLabel,
          enemy: m.defenderPlayerName || m.defenderLineupLabel || "-",
          lineup: m.attackerLineupLabel || "-",
          code: m.battleCode,
        });
      }
    }
    items.sort((a, b) => b.time.localeCompare(a.time));
    return items;
  }, [reportRows, lineupAnalysis.matchups, dateFrom, dateTo]);

  // 服务端已按 [from, to) 过滤，客户端不再重复筛选
  const filtered = timelineItems;

  // 统一胜率口径（单对单·攻方视角）：平局计半胜、unknown 不入分母、守方胜不算我方胜。
  const winRateSummary = useMemo(
    () => summarizeWinRate(filtered.map((it) => attackerOutcomeFromResult(it.result) as WinRateOutcome)),
    [filtered],
  );
  const totalBattles = winRateSummary.total;
  const totalWins = winRateSummary.wins;
  const totalLosses = winRateSummary.losses;
  const winRate = totalBattles > 0 ? (winRateSummary.winRate * 100).toFixed(1) + "%" : "-";
  const groups = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of filtered) {
      const dk = dateKey(item.time);
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(item);
    }
    const result: DayGroup[] = [];
    for (const [date, items] of map) {
      let wins = 0,
        losses = 0,
        draws = 0;
      for (const b of items) {
        const label = resultBadge(b.result).label;
        if (label === "胜") wins++;
        else if (label === "负") losses++;
        else draws++;
      }
      result.push({ date, items, wins, losses, draws });
    }
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }, [filtered]);

  return (
    <div className="p-5">
      <PageHead
        title="战报时间线"
        description="按日期复盘胜负、对手与阵容变化，默认展开最近一天。"
        actions={
          <DateRangeFilter
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onReset={() => {
              setDateFrom("");
              setDateTo("");
            }}
          />
        }
      />

      <section className="surface-card mb-4 grid grid-cols-4 divide-x divide-[var(--hair)] overflow-hidden">
        {[
          ["总场次", totalBattles, "text-foreground"],
          ["胜场", totalWins, "text-victory"],
          ["负场", totalLosses, "text-defeat"],
          ["综合胜率", winRate, "text-primary"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="px-4 py-3">
            <p className="text-[10.5px] tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-[22px] font-semibold tabular-nums ${tone}`}>{value}</p>
          </div>
        ))}
      </section>

      {reportRows.length > 0 ? (
        <UnitCard className="mb-4" title="近 7 天战况" tag="柱形为场次 · 折线为胜率">
          <BattleWinRateChart battles={reportRows} days={7} />
        </UnitCard>
      ) : null}

      {reportRows.length >= 1000 ? (
        <p className="text-[11.5px] text-muted-foreground">仅统计最近 1000 条战报，更早记录未计入。</p>
      ) : null}

      {dateError ? (
        <ErrorState message={dateError} />
      ) : reportsQuery.isError ? (
        <ErrorState message={`战报加载失败：${formatErrorMessage(reportsQuery.error)}`} />
      ) : reportsQuery.isLoading && reportRows.length === 0 ? (
        <SuspenseFallback variant="page" />
      ) : groups.length === 0 ? (
        <EmptyState title="暂无战报数据。请先进行同盟战报采集，采集完成后这里会自动展示战报时间线。" />
      ) : (
        <section className="surface-card overflow-hidden" aria-label="按日期分组的战报">
          {groups.map((group, index) => (
            <TimelineDay
              key={group.date}
              group={group}
              defaultOpen={index === 0}
              onExportBattleReport={onExportBattleReport}
            />
          ))}
        </section>
      )}
    </div>
  );
});
