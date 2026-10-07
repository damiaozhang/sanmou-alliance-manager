import { BarChart3, Clock3, ShieldEllipsis } from "lucide-react";

import type { ReportRecord, SummaryPair, TopUnitSummary } from "../types";
import { asNumber } from "../utils/helpers";
import { formatCount } from "../utils/format";
import { deriveReportDetails } from "../utils/battle";
import { SummaryTable } from "../components/ui/SummaryTable";
import { TopUnitsTable } from "../components/ui/TopUnitsTable";
import { MetricCard } from "@/components/MetricCard";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type DebugStatsTabProps = {
  selectedReport: ReportRecord | null;
  reportDetails: ReturnType<typeof deriveReportDetails>;
  summaryEventTypes: SummaryPair[];
  summaryTopSkills: SummaryPair[];
  summaryTopUnits: TopUnitSummary[];
};

export function DebugStatsTab(props: DebugStatsTabProps): JSX.Element {
  const { selectedReport, reportDetails, summaryEventTypes, summaryTopSkills, summaryTopUnits } = props;
  return (
    <div className="space-y-4">
      <CollapsibleCard title="解析诊断" icon={BarChart3}>
        {!selectedReport && <p className="text-sm text-muted-foreground">先在战报库或战报详情里选一份报告。</p>}
        {selectedReport && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="事件总数" value={formatCount(asNumber(reportDetails.summary["event_count"]) ?? selectedReport.eventCount)} tone="primary" />
              <MetricCard label="回合" value={formatCount(asNumber(reportDetails.summary["round_count"]))} tone="info" />
              <MetricCard label="伤害事件" value={formatCount(asNumber(reportDetails.summary["damage_events"]))} tone="defeat" />
              <MetricCard label="治疗事件" value={formatCount(asNumber(reportDetails.summary["heal_events"]))} tone="victory" />
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <SummaryTable title="高频技能" rows={summaryTopSkills} emptyText="当前报告没有可用的技能频次。" />
              <SummaryTable title="事件类型" rows={summaryEventTypes} emptyText="当前报告没有可用的事件类型统计。" />
              <TopUnitsTable rows={summaryTopUnits} />
            </div>
          </div>
        )}
      </CollapsibleCard>
      <CollapsibleCard title="武将诊断" icon={BarChart3}>
        {!selectedReport && <p className="text-sm text-muted-foreground">先在战报库或战报详情里选一份报告。</p>}
        {selectedReport && reportDetails.heroStats.length === 0 && <p className="text-sm text-muted-foreground">当前报告没有结构化英雄统计。被动协议报告会优先展示事件级摘要。</p>}
        {reportDetails.heroStats.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow><TableHead>武将</TableHead><TableHead>造成伤害</TableHead><TableHead>承受伤害</TableHead><TableHead>治疗</TableHead><TableHead>发动</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {reportDetails.heroStats.map(([name, stats]) => (
                <TableRow key={name}>
                  <TableCell>{name}</TableCell>
                  <TableCell className="text-defeat">{formatCount(asNumber(stats["damage_dealt"]) ?? asNumber(stats["damageDealt"]))}</TableCell>
                  <TableCell>{formatCount(asNumber(stats["damage_taken"]) ?? asNumber(stats["damageTaken"]))}</TableCell>
                  <TableCell className="text-victory">{formatCount(asNumber(stats["heal_done"]) ?? asNumber(stats["healDone"]))}</TableCell>
                  <TableCell className="text-info">{formatCount(asNumber(stats["skill_cast_count"]) ?? asNumber(stats["skillCastCount"]))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CollapsibleCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <CollapsibleCard title="原始部署 JSON" icon={ShieldEllipsis}><pre className="min-h-[260px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-6">{JSON.stringify(reportDetails.deploy, null, 2) || "{}"}</pre></CollapsibleCard>
        <CollapsibleCard title="原始阵容 / Buff JSON" icon={Clock3}><pre className="min-h-[260px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-6">{JSON.stringify({ lineup: reportDetails.lineup, buffs: reportDetails.buffs, summary: reportDetails.summary }, null, 2)}</pre></CollapsibleCard>
      </div>
    </div>
  );
}
