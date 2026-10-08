import React, { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { MemberSnapshotRow, CrossWorkspacePowerPoint } from "../tauri";
import { getCrossWorkspacePowerSeries, getComparisonStats } from "../tauri";
import type { ComparisonWindow } from "@/features/comparison/windows";
import { deriveComparisonWindows, latestByKey } from "@/features/comparison/windows";
import { formatDeltaNumber } from "@/lib/format";
import { useAppData, useAllMemberSnapshots } from "@/app/queries";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { TrendChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { PageHead } from "@/components/PageHead";
import { UnitCard } from "@/components/UnitCard";
import { EnhancedTable } from "@/components/EnhancedTable";
import { ErrorState } from "@/components/ErrorState";

type ComparisonRow = { label: string; current: string; previous: string; delta: string };
type WindowStats = { members: number; buildings: number; battles: number; sessions: number };

const EMPTY_COMPARISON_ROWS: ComparisonRow[] = [];
const EMPTY_MEMBER_SNAPSHOTS: MemberSnapshotRow[] = [];

// 口径标注（阶段4 定稿）：get_comparison_stats 返回的是窗口内落库行数，非去重计数
const COMPARISON_ROW_HINTS: Record<string, string> = {
  "成员快照": "窗口内快照行数（非去重人数）",
  "设施快照": "窗口内设施快照行数",
  "战报": "窗口内战报行数",
  "采集记录": "窗口内采集会话数",
};

export const ComparisonPage = React.memo(function ComparisonPage() {
  // 阶段4：页面自取数据，不再接收 App 下钻的 bundle props
  const { workspaceId } = useActiveWorkspaceContext();
  const { bundle } = useAppData(workspaceId);
  // 阶段3b：大表不再随 bundle 下发，对比窗口由采集会话时间线推导
  const defaultWindows = useMemo(
    () => deriveComparisonWindows(bundle?.captureSessions ?? []),
    [bundle],
  );
  const [currentFrom, setCurrentFrom] = useState("");
  const [currentTo, setCurrentTo] = useState("");
  const [previousFrom, setPreviousFrom] = useState("");
  const [previousTo, setPreviousTo] = useState("");
  const [initialized, setInitialized] = useState(false);

  // 工作区切换后（workspaceId 变化）重置日期窗口，避免沿用旧工作区的窗口范围导致数据为空
  useEffect(() => {
    setInitialized(false);
  }, [workspaceId]);

  useEffect(() => {
    if (initialized) return;
    if (!defaultWindows.current.from && !defaultWindows.previous.from) return;
    setCurrentFrom(defaultWindows.current.from);
    setCurrentTo(defaultWindows.current.to);
    setPreviousFrom(defaultWindows.previous.from);
    setPreviousTo(defaultWindows.previous.to);
    setInitialized(true);
  }, [defaultWindows, initialized]);

  const currentWindow = useMemo<ComparisonWindow>(
    () => ({ from: currentFrom, to: currentTo }),
    [currentFrom, currentTo],
  );
  const previousWindow = useMemo<ComparisonWindow>(
    () => ({ from: previousFrom, to: previousTo }),
    [previousFrom, previousTo],
  );

  // 双窗口计数走 SQL 统计（get_comparison_stats），避免全量序列化后在内存过滤
  const [currentStats, setCurrentStats] = useState<WindowStats | null>(null);
  const [previousStats, setPreviousStats] = useState<WindowStats | null>(null);
  // P1-9：此前用 `.catch(() => null)` 静默吞错，拉数失败时表格只剩空白/0，
  // 用户分不清"真的没数据"和"取数失败"。这里把错误暴露到界面。
  const [statsError, setStatsError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) {
      setCurrentStats(null);
      setPreviousStats(null);
      setStatsError(null);
      return;
    }
    let cancelled = false;
    const fetchWindow = (from: string, to: string): Promise<WindowStats | null> =>
      from && to
        ? getComparisonStats(workspaceId, from, to)
        : Promise.resolve(null);
    setStatsError(null);
    Promise.all([
      fetchWindow(currentFrom, currentTo),
      fetchWindow(previousFrom, previousTo),
    ])
      .then(([cur, prev]) => {
        if (cancelled) return;
        setCurrentStats(cur);
        setPreviousStats(prev);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCurrentStats(null);
        setPreviousStats(null);
        setStatsError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [workspaceId, currentFrom, currentTo, previousFrom, previousTo]);

  const rows = useMemo<ComparisonRow[]>(() => {
    if (!currentStats || !previousStats) return EMPTY_COMPARISON_ROWS;
    const mk = (label: string, cur: number, prev: number): ComparisonRow => ({
      label,
      current: String(cur),
      previous: String(prev),
      delta: formatDeltaNumber(cur, prev),
    });
    return [
      mk("成员快照", currentStats.members, previousStats.members),
      mk("设施快照", currentStats.buildings, previousStats.buildings),
      mk("战报", currentStats.battles, previousStats.battles),
      mk("采集记录", currentStats.sessions, previousStats.sessions),
    ];
  }, [currentStats, previousStats]);

  // 成员变化：P1-3 修复——拉取全量历史快照（循环分页），不再固定 2000 条上限，
  // 避免历史窗口外数据被截断导致"离盟/新入盟"判定遗漏。
  const memberHistoryQuery = useAllMemberSnapshots(workspaceId);
  const memberSnapshots = memberHistoryQuery.data ?? EMPTY_MEMBER_SNAPSHOTS;
  const memberChanges = useMemo(() => {
    const currentLatest = latestByKey(
      memberSnapshots,
      (r) => r.avatarId,
      (r) => r.observedAt,
      currentWindow
    );
    const previousLatest = latestByKey(
      memberSnapshots,
      (r) => r.avatarId,
      (r) => r.observedAt,
      previousWindow
    );
    const currentMap = new Map(currentLatest.map((r) => [r.avatarId, r]));
    const previousMap = new Map(previousLatest.map((r) => [r.avatarId, r]));
    const joined: MemberSnapshotRow[] = [];
    const left: MemberSnapshotRow[] = [];
    const retained: Array<{ current: MemberSnapshotRow; previous: MemberSnapshotRow }> = [];
    for (const [id, row] of currentMap) {
      const prev = previousMap.get(id);
      if (prev) {
        retained.push({ current: row, previous: prev });
      } else {
        joined.push(row);
      }
    }
    for (const [id, row] of previousMap) {
      if (!currentMap.has(id)) {
        left.push(row);
      }
    }
    return { joined, left, retained };
  }, [memberSnapshots, currentWindow, previousWindow]);

  const currentWindowLabel = currentFrom && currentTo ? `${currentFrom} ~ ${currentTo}` : "全部";
  const previousWindowLabel = previousFrom && previousTo ? `${previousFrom} ~ ${previousTo}` : "全部";

  const currentHighlights: Array<{ label: string; current: string; hint: string }> = currentStats
    ? [
        { label: "成员快照", current: String(currentStats.members), hint: "窗口内快照行数（非去重人数）" },
        { label: "设施快照", current: String(currentStats.buildings), hint: "窗口内设施快照行数" },
        { label: "战报", current: String(currentStats.battles), hint: "窗口内战报行数" },
        { label: "采集记录", current: String(currentStats.sessions), hint: "窗口内采集会话数" },
      ]
    : rows.slice(0, 4).map((r) => ({ label: r.label, current: r.current, hint: COMPARISON_ROW_HINTS[r.label] ?? "" }));

  // 跨工作区战力趋势（独立数据源，与工作区对比窗口无关）
  const [powerSeries, setPowerSeries] = useState<CrossWorkspacePowerPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCrossWorkspacePowerSeries()
      .then((rowsData) => { if (!cancelled) setPowerSeries(rowsData); })
      .catch(() => { if (!cancelled) setPowerSeries([]); });
    return () => { cancelled = true; };
  }, []);

  const powerByWorkspace = useMemo(() => {
    const map = new Map<number, { id: number; name: string; points: CrossWorkspacePowerPoint[] }>();
    for (const p of powerSeries) {
      let entry = map.get(p.workspaceId);
      if (!entry) {
        entry = { id: p.workspaceId, name: p.workspaceName || `工作区 ${p.workspaceId}`, points: [] };
        map.set(p.workspaceId, entry);
      }
      entry.points.push(p);
    }
    for (const entry of map.values()) {
      entry.points.sort((a, b) => a.date.localeCompare(b.date));
    }
    return [...map.values()];
  }, [powerSeries]);

  function resetWindows() {
    setCurrentFrom(defaultWindows.current.from);
    setCurrentTo(defaultWindows.current.to);
    setPreviousFrom(defaultWindows.previous.from);
    setPreviousTo(defaultWindows.previous.to);
    setInitialized(true);
  }

  return (
    <div className="p-5">
      <PageHead
        title="时间对比"
        description="对比两个时间窗口的采集量与成员变化，定位同盟增长或流失。"
        actions={
          <Button variant="outline" onClick={resetWindows}>
            <BarChart3 size={16} className="mr-2" />
            恢复默认窗口
          </Button>
        }
      />
      {statsError ? (
        <ErrorState message={`对比数据加载失败：${statsError}。请确认工作区可用后重试。`} />
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <UnitCard title="当前窗口" tag={currentWindowLabel}>
          <DateRangeFilter from={currentFrom} to={currentTo} onFromChange={setCurrentFrom} onToChange={setCurrentTo} />
        </UnitCard>
        <UnitCard title="对照窗口" tag={previousWindowLabel}>
          <DateRangeFilter from={previousFrom} to={previousTo} onFromChange={setPreviousFrom} onToChange={setPreviousTo} />
        </UnitCard>
      </div>

      <section className="surface-card mb-4 grid grid-cols-2 divide-x divide-[var(--hair)] overflow-hidden md:grid-cols-4">
        {currentHighlights.map((item) => (
          <div key={item.label} className="px-4 py-3">
            <p className="text-xs tracking-wide text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-metric font-semibold tabular-nums">{item.current}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.hint}>
              {item.hint}
            </p>
          </div>
        ))}
      </section>

      <p className="mb-4 text-sm text-muted-foreground">
        口径说明：上表与高亮卡数字均为窗口内落库行数（SQL 单源 get_comparison_stats），
        其中「成员快照」是快照行数而非去重人数；去重人数见下方「成员变化」（按成员去重）。
      </p>

      <EnhancedTable
        columns={["指标", "当前", "上次", "变化"]}
        rows={rows}
        density="compact"
        renderRow={(row) => (
          <>
            <TableCell>{row.label}</TableCell>
            <TableCell>{row.current}</TableCell>
            <TableCell>{row.previous}</TableCell>
            <TableCell>{row.delta}</TableCell>
          </>
        )}
      />

      <UnitCard className="mt-4" title="成员变化" tag="按成员去重">
        <div className="mb-4 grid grid-cols-3 divide-x divide-[var(--hair)]">
          <div className="px-4 py-2 first:pl-0">
            <p className="text-xs text-muted-foreground">新入盟</p>
            <p className="mt-0.5 text-metric font-semibold tabular-nums text-victory">{memberChanges.joined.length}</p>
          </div>
          <div className="px-4 py-2">
            <p className="text-xs text-muted-foreground">离盟</p>
            <p className="mt-0.5 text-metric font-semibold tabular-nums text-defeat">{memberChanges.left.length}</p>
          </div>
          <div className="px-4 py-2">
            <p className="text-xs text-muted-foreground">留存</p>
            <p className="mt-0.5 text-metric font-semibold tabular-nums">{memberChanges.retained.length}</p>
          </div>
        </div>
        <div className="space-y-4">
          {memberChanges.joined.length > 0 && (
            <Table dense>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-victory">新入盟</TableHead>
                  <TableHead>玩家 ID</TableHead>
                  <TableHead>周贡献</TableHead>
                  <TableHead>周武勋</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberChanges.joined.map((m) => (
                  <TableRow key={m.avatarId}>
                    <TableCell>{m.avatarName}</TableCell>
                    <TableCell>{m.avatarId}</TableCell>
                    <TableCell>{m.weeklyContribution}</TableCell>
                    <TableCell>{m.weeklyMerit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {memberChanges.left.length > 0 && (
            <Table dense>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-defeat">离盟</TableHead>
                  <TableHead>玩家 ID</TableHead>
                  <TableHead>周贡献</TableHead>
                  <TableHead>周武勋</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberChanges.left.map((m) => (
                  <TableRow key={m.avatarId}>
                    <TableCell>{m.avatarName}</TableCell>
                    <TableCell>{m.avatarId}</TableCell>
                    <TableCell>{m.weeklyContribution}</TableCell>
                    <TableCell>{m.weeklyMerit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {memberChanges.retained.length > 0 && (
            <Table dense>
              <TableHeader>
                <TableRow>
                  <TableHead>留存成员</TableHead>
                  <TableHead>玩家 ID</TableHead>
                  <TableHead>周贡献变化</TableHead>
                  <TableHead>周武勋变化</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberChanges.retained.map(({ current, previous }) => (
                  <TableRow key={current.avatarId}>
                    <TableCell>{current.avatarName}</TableCell>
                    <TableCell>{current.avatarId}</TableCell>
                    <TableCell>{current.weeklyContribution - previous.weeklyContribution >= 0 ? "+" : ""}{current.weeklyContribution - previous.weeklyContribution}</TableCell>
                    <TableCell>{current.weeklyMerit - previous.weeklyMerit >= 0 ? "+" : ""}{current.weeklyMerit - previous.weeklyMerit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </UnitCard>

      {powerByWorkspace.length > 0 && (
        <UnitCard className="mt-4" title="跨工作区战力趋势" tag="周武勋总量">
          <p className="mb-3 text-sm text-muted-foreground">各工作区周武勋总量随日期的变化趋势。</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {powerByWorkspace.map((ws) => {
              const first = ws.points[0];
              const last = ws.points[ws.points.length - 1];
              return (
                <TrendChart
                  key={ws.id}
                  data={ws.points.map((p) => p.totalWeeklyMerit)}
                  width={360}
                  height={80}
                  label={`${ws.name} · ${first?.date ?? ""} ~ ${last?.date ?? ""}`}
                  currentValue={last?.totalWeeklyMerit ?? 0}
                  color="hsl(var(--chart-1))"
                />
              );
            })}
          </div>
        </UnitCard>
      )}
    </div>
  );
});
