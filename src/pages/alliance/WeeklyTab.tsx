import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { SortIndicator } from "@/components/SortIndicator";
import { MetricCard } from "@/components/MetricCard";
import { TruncatedText } from "@/components/TruncatedText";
import { useToggleSort } from "@/hooks/useToggleSort";
import { ROUTE_PATHS } from "@/app/routes";
import {
  type AllianceDisplayMember,
  type WeeklySortKey,
  summarizeAllianceWeekly,
  weeklySortValue
} from "@/features/alliance/members";
import {
  WEEKLY_STAT_COLUMNS,
  WEEKLY_STAT_LABELS,
  formatWeekLabel,
  formatWeeklyDeltaRatio,
  weeklySparkRatios
} from "@/features/alliance/weeklyStats";
import { sortRows } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { ALLIANCE_SCANNING_EMPTY } from "@/lib/labels";

const EMPTY = "—";

/**
 * 同盟「周维度」视图。
 *
 * 数据来自 `member_snapshot.weekly_statistics_json`（游戏协议 `weeklyStaticsticsData`，
 * 含本周 + 前两周）。**关键口径**：只对 `weeklySummary` 非空的成员计数与求和——
 * 没有周数据的成员按 0 计入会把「没采到」伪装成「本周没打」，这是本页最要避免的误读，
 * 所以覆盖人数单独作为一个 KPI 展示。
 *
 * 配色按「越高越好」语义：战功增长用 `victory`（绿），下降用 `defeat`（红）。
 */
export function WeeklyTab({
  members,
  allianceCaptureRunning
}: {
  members: AllianceDisplayMember[];
  allianceCaptureRunning: boolean;
}) {
  const navigate = useNavigate();
  const { sort, toggle } = useToggleSort<WeeklySortKey>({ key: "feat", direction: "desc" });

  const covered = useMemo(
    () => members.filter((member) => member.weeklySummary?.current),
    [members]
  );
  const rows = useMemo(() => sortRows(covered, sort, weeklySortValue), [covered, sort]);
  const totals = useMemo(() => summarizeAllianceWeekly(members), [members]);

  if (covered.length === 0) {
    return (
      <EmptyState
        title={allianceCaptureRunning ? ALLIANCE_SCANNING_EMPTY : "当前工作区暂无成员周维度数据。"}
        action={
          allianceCaptureRunning
            ? undefined
            : { label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }
        }
      />
    );
  }

  const coverageRate = members.length > 0 ? covered.length / members.length : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="覆盖成员"
          value={`${covered.length} / ${members.length}`}
          hint={`本次快照含周统计的成员占比 ${Math.round(coverageRate * 100)}%；未覆盖的成员不计入下方合计`}
          tone={coverageRate < 1 ? "info" : "default"}
        />
        <MetricCard
          label="本周战功合计"
          value={totals.feat.toLocaleString("zh-CN")}
          hint={`仅统计有周数据的 ${totals.coveredMembers} 人`}
          tone="primary"
        />
        <MetricCard
          label="本周贡献合计"
          value={totals.contri.toLocaleString("zh-CN")}
          hint="口径同上周数据来源，联盟内汇总"
        />
        <MetricCard
          label="战功环比中位数"
          value={formatWeeklyDeltaRatio(totals.featDeltaRatioMedian)}
          hint={
            totals.comparableMembers > 0
              ? `${totals.comparableMembers} 人有上周可比数据；中位数比平均值更抗个别极端值`
              : "当前快照没有可比的上一周数据"
          }
          tone={
            totals.featDeltaRatioMedian === null
              ? "muted"
              : totals.featDeltaRatioMedian >= 0
                ? "victory"
                : "defeat"
          }
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>成员</TableHead>
            <TableHead>军团</TableHead>
            {WEEKLY_STAT_COLUMNS.map((key) => (
              <TableHead key={key} className="text-right">
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground"
                  onClick={() => toggle(key)}
                >
                  本周{WEEKLY_STAT_LABELS[key]}
                  <SortIndicator active={sort.key === key} direction={sort.direction} />
                </button>
              </TableHead>
            ))}
            <TableHead className="text-right">
              <button
                type="button"
                className="cursor-pointer hover:text-foreground"
                onClick={() => toggle("featDeltaRatio")}
              >
                战功环比
                <SortIndicator active={sort.key === "featDeltaRatio"} direction={sort.direction} />
              </button>
            </TableHead>
            <TableHead>近 {Math.max(...rows.map((row) => row.weeklySummary?.weeks.length ?? 0))} 周战功</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((member) => {
            const summary = member.weeklySummary;
            const current = summary?.current;
            const spark = summary ? weeklySparkRatios(summary.weeks) : [];
            const ratio = summary?.featDeltaRatio ?? null;
            return (
              <TableRow key={`${member.avatarId || member.name}-${member.coord}-${member.official}`}>
                <TableCell>
                  <TruncatedText>{member.name}</TruncatedText>
                </TableCell>
                <TableCell>{member.legion || EMPTY}</TableCell>
                {WEEKLY_STAT_COLUMNS.map((key) => (
                  <TableCell key={key} className="text-right tabular-nums">
                    {current && current[key] !== 0 ? current[key].toLocaleString("zh-CN") : EMPTY}
                  </TableCell>
                ))}
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    ratio === null ? "" : ratio >= 0 ? "text-victory" : "text-defeat"
                  )}
                  title={
                    summary?.featDelta !== null && summary?.featDelta !== undefined
                      ? `较上周 ${summary.featDelta >= 0 ? "+" : ""}${summary.featDelta.toLocaleString("zh-CN")}`
                      : "没有可比的上一周"
                  }
                >
                  {formatWeeklyDeltaRatio(ratio)}
                </TableCell>
                <TableCell>
                  <WeeklySparkline ratios={spark} weeks={summary?.weeks ?? []} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        周起始以游戏返回的 timestamp 为准（{rows[0]?.weeklySummary?.weeks.length ?? 0} 周内），
        不按序号推断周次；跨周后整组数据整体右移。
      </p>
    </div>
  );
}

/**
 * 迷你趋势条：柱高按各周相对最大值归一。
 * 全部为 0 时不画图（返回占位），避免"一排等高柱"被误读成"每周都一样"。
 */
function WeeklySparkline({
  ratios,
  weeks
}: {
  ratios: number[];
  weeks: Array<{ timestamp: number; feat: number }>;
}) {
  if (ratios.length === 0) return <span className="text-muted-foreground">{EMPTY}</span>;
  return (
    <div className="flex items-end gap-[3px]" role="img" aria-label="近几周战功趋势">
      {ratios.map((ratio, index) => (
        <span
          key={`${weeks[index]?.timestamp ?? index}`}
          className="w-2 rounded-sm bg-primary/60"
          style={{ height: `${Math.max(3, Math.round(ratio * 22))}px` }}
          title={`${formatWeekLabel(weeks[index]?.timestamp ?? 0)} 战功 ${weeks[index]?.feat.toLocaleString("zh-CN") ?? EMPTY}`}
        />
      ))}
    </div>
  );
}
