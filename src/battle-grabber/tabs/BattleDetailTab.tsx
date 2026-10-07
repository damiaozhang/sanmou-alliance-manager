import { Activity, FolderOpen, ScrollText } from "lucide-react";

import type { BattleDetails, ReportRecord } from "../types";
import { asNumber } from "../utils/helpers";
import { formatCount } from "../utils/format";
import { deriveReportDetails, getReportFolder, reportKey } from "../utils/battle";
import { BattleOutcomeSummary } from "../components/battle/BattleOutcomeSummary";
import { BattleDetailsView } from "../components/battle/BattleDetailsView";
import { MetricCard } from "@/components/MetricCard";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BattleDetailTabProps = {
  visibleReports: ReportRecord[];
  visibleReportSessionId: string;
  selectedReportId: string;
  setSelectedReportId: (id: string) => void;
  setFocusedReportSessionId: (id: string) => void;
  selectedReport: ReportRecord | null;
  reportDetails: ReturnType<typeof deriveReportDetails>;
  parsedBattleDetails: BattleDetails | null;
  loadingReport: boolean;
  openReportFolder: (report: ReportRecord | null) => Promise<void>;
};

export function BattleDetailTab(props: BattleDetailTabProps): JSX.Element {
  const {
    visibleReports, visibleReportSessionId, selectedReportId, setSelectedReportId,
    setFocusedReportSessionId, selectedReport, reportDetails, parsedBattleDetails, loadingReport, openReportFolder,
  } = props;
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <CollapsibleCard title="报告列表" icon={ScrollText}>
        <div className="space-y-2">
          {visibleReportSessionId && <p className="text-caption text-muted-foreground">当前查看会话: <span className="text-foreground">{visibleReportSessionId}</span></p>}
          {visibleReports.length === 0 && <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">还没有可查看的战报。被动抓取拿到 `1008` 报文后，这里会自动出现。</p>}
          {visibleReports.map((r) => {
            const active = reportKey(r) === selectedReportId;
            return (
              <button key={reportKey(r)} type="button" onClick={() => { setFocusedReportSessionId(r.sessionId); setSelectedReportId(reportKey(r)); }}
                className={cn("w-full rounded-md border px-3 py-3 text-left transition", active ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-muted-foreground/50")}>
                <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{r.id}</p><span className="text-caption text-muted-foreground">{formatCount(r.eventCount)} 事件</span></div>
                <p className="mt-1 text-caption text-muted-foreground">{r.sessionId}</p>
              </button>
            );
          })}
        </div>
      </CollapsibleCard>
      <section className="space-y-4">
        <CollapsibleCard title="报告概览" icon={Activity}>
          {!selectedReport && <p className="text-sm text-muted-foreground">请选择一份报告。</p>}
          {selectedReport && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void openReportFolder(selectedReport)} disabled={!getReportFolder(selectedReport)}><FolderOpen className="mr-2 h-4 w-4" />打开文件夹</Button></div>
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="事件总数" value={formatCount(asNumber(reportDetails.summary["event_count"]) ?? selectedReport.eventCount)} tone="primary" />
                <MetricCard label="回合" value={formatCount(asNumber(reportDetails.summary["round_count"]) ?? parsedBattleDetails?.endRound)} tone="info" />
                <MetricCard label="伤害事件" value={formatCount(asNumber(reportDetails.summary["damage_events"]))} tone="defeat" />
                <MetricCard label="治疗事件" value={formatCount(asNumber(reportDetails.summary["heal_events"]))} tone="victory" />
              </div>
              {parsedBattleDetails && <BattleOutcomeSummary details={parsedBattleDetails} />}
              {parsedBattleDetails && <BattleDetailsView details={parsedBattleDetails} />}
              <div className="rounded-md border bg-muted p-3">
                <div className="mb-2 flex items-center justify-between text-caption text-muted-foreground"><span>{selectedReport.sessionId}</span><span>{loadingReport ? "加载中..." : selectedReport.txt || selectedReport.json}</span></div>
                <pre className={cn("overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6", parsedBattleDetails ? "h-[360px]" : "h-[640px]")}>{reportDetails.textContent || "这份报告主要是结构化数据，文本内容为空。"}</pre>
              </div>
            </div>
          )}
        </CollapsibleCard>
      </section>
    </div>
  );
}
