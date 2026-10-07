import { FileText, FolderOpen, History, RefreshCcw, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import type { ReportRecord, SessionRecord, TabId } from "../types";
import { formatCount, formatTime } from "../utils/format";
import { getReportAiPath, getReportFolder, reportKey } from "../utils/battle";
import { MetricCard } from "@/components/MetricCard";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 阶段3b：战报库列表改 DataTable 客户端分页 + 虚拟化，替代「加载更多」模式
const REPORT_LIBRARY_PAGE_SIZE = 50;

export type BattleHistoryTabProps = {
  allReports: ReportRecord[];
  usefulSessions: SessionRecord[];
  emptySessions: SessionRecord[];
  selectedReport: ReportRecord | null;
  selectedReportId: string;
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
  setFocusedReportSessionId: (id: string) => void;
  setSelectedReportId: (id: string) => void;
  setSelectedTab: (tab: TabId) => void;
  refreshSnapshot: () => Promise<void>;
  openReportFolder: (report: ReportRecord | null) => Promise<void>;
};

export function BattleHistoryTab(props: BattleHistoryTabProps): JSX.Element {
  const {
    allReports, usefulSessions, emptySessions, selectedReport, selectedReportId,
    selectedSessionId, setSelectedSessionId, setFocusedReportSessionId, setSelectedReportId, setSelectedTab,
    refreshSnapshot, openReportFolder,
  } = props;
  // 战报库客户端分页
  const [reportPage, setReportPage] = useState(1);
  const pagedReports = useMemo(
    () => allReports.slice((reportPage - 1) * REPORT_LIBRARY_PAGE_SIZE, reportPage * REPORT_LIBRARY_PAGE_SIZE),
    [allReports, reportPage],
  );
  const reportColumns = useMemo<DataTableColumn<ReportRecord>[]>(
    () => [
      { key: "id", header: "战报", width: "minmax(140px,1fr)", render: (r) => <span className="font-medium">{r.id}</span> },
      { key: "session", header: "会话", width: "minmax(120px,1fr)", cellClassName: "text-muted-foreground", render: (r) => r.sessionId },
      { key: "events", header: "事件数", width: "80px", headerClassName: "justify-end", cellClassName: "text-right tabular-nums", render: (r) => formatCount(r.eventCount) },
      { key: "ai", header: "AI 产物", width: "minmax(120px,1fr)", cellClassName: "text-victory", render: (r) => getReportAiPath(r) || "-" },
    ],
    [],
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <CollapsibleCard title="战报库" icon={History}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-caption text-muted-foreground">{formatCount(allReports.length)} 份战报</span>
          <Button variant="outline" size="sm" onClick={() => void refreshSnapshot()}><RefreshCcw className="mr-2 h-4 w-4" />刷新</Button>
        </div>
        <div className="space-y-2">
          {allReports.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">暂无单份战报。连接后打开 1008 战报详情，这里会自动积累。</p>
          ) : (
            <DataTable
              rows={pagedReports}
              total={allReports.length}
              page={reportPage}
              pageSize={REPORT_LIBRARY_PAGE_SIZE}
              onPageChange={setReportPage}
              columns={reportColumns}
              rowKey={(r) => `library:${reportKey(r)}`}
              rowHeight={40}
              maxHeight={420}
              emptyTitle="暂无单份战报"
              onRowClick={(r) => { setFocusedReportSessionId(r.sessionId); setSelectedReportId(reportKey(r)); }}
              rowClassName={(r) => (reportKey(r) === selectedReportId ? "border-primary/60 bg-primary/10" : undefined)}
            />
          )}
        </div>
      </CollapsibleCard>
      <section className="space-y-4">
        <CollapsibleCard title="选中战报" icon={ScrollText}>
          {!selectedReport && <p className="text-sm text-muted-foreground">选择左侧战报查看保存路径和详情入口。</p>}
          {selectedReport && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="事件" value={formatCount(selectedReport.eventCount)} tone="primary" />
                <MetricCard label="旧 JSON" value={selectedReport.json ? "有" : "无"} tone="info" />
                <MetricCard label="AI JSON" value={selectedReport.battleJson ? "有" : "无"} tone="victory" />
                <MetricCard label="AI MD" value={selectedReport.battleMd ? "有" : "无"} tone="defeat" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setFocusedReportSessionId(selectedReport.sessionId); setSelectedReportId(reportKey(selectedReport)); setSelectedTab("battle"); }}><ScrollText className="mr-2 h-4 w-4" />查看详情</Button>
                <Button variant="outline" onClick={() => void openReportFolder(selectedReport)} disabled={!getReportFolder(selectedReport)}><FolderOpen className="mr-2 h-4 w-4" />打开文件夹</Button>
              </div>
              <div className="rounded-md border bg-muted p-3 text-sm"><p>报告: {selectedReport.id}</p><p className="mt-1 text-caption text-muted-foreground">会话: {selectedReport.sessionId}</p></div>
              <div className="space-y-2 rounded-md border bg-muted p-3 text-caption text-muted-foreground">
                <p className="break-all">AI Markdown: {selectedReport.battleMd || "-"}</p>
                <p className="break-all">AI JSON: {selectedReport.battleJson || "-"}</p>
                <p className="break-all">旧 JSON: {selectedReport.json || "-"}</p>
                <p className="break-all">HTML: {selectedReport.html || "-"}</p>
              </div>
            </div>
          )}
        </CollapsibleCard>
        <CollapsibleCard title="采集诊断会话" icon={FileText}>
          <div className="space-y-2">
            {usefulSessions.length === 0 && <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">暂无包含战报或同盟记录的会话。</p>}
            {usefulSessions.slice(0, 40).map((s) => {
              const active = s.id === selectedSessionId;
              return (
                <button key={s.id} type="button" onClick={() => { setSelectedSessionId(s.id); setFocusedReportSessionId(s.id); }}
                  className={cn("w-full rounded-md border px-3 py-3 text-left", active ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-muted-foreground/50")}>
                  <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{s.id}</p><Badge variant="secondary">{s.source.toUpperCase()}</Badge></div>
                  <p className="mt-1 text-caption text-muted-foreground">{formatTime(s.generatedAt)}</p>
                  <p className="mt-2 text-caption text-muted-foreground">{s.process?.name || "未知进程"} · {formatCount(s.reportCount)} 报告 · {formatCount(s.allianceCount)} 同盟</p>
                </button>
              );
            })}
            {emptySessions.length > 0 && (
              <details className="rounded-md border bg-card px-3 py-2 text-caption text-muted-foreground">
                <summary className="cursor-pointer">空会话 {formatCount(emptySessions.length)} 个</summary>
                <div className="mt-2 space-y-1">{emptySessions.slice(0, 60).map((s) => <p key={`empty:${s.id}`} className="truncate">{s.id} · {formatTime(s.generatedAt)}</p>)}</div>
              </details>
            )}
          </div>
        </CollapsibleCard>
      </section>
    </div>
  );
}
