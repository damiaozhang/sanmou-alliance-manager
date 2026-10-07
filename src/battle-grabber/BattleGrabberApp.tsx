import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, History, Network, ScrollText, ShieldEllipsis } from "lucide-react";

import type { ReportRecord, TabId } from "./types";
import { formatCount } from "./utils/format";
import { getReportFolder } from "./utils/battle";
import { useBattleSnapshot } from "./hooks/useBattleSnapshot";
import { useLineupSync } from "./hooks/useLineupSync";
import { useReportBrowser } from "./hooks/useReportBrowser";
import { useCaptureControls } from "./hooks/useCaptureControls";
import { useTabUrl } from "@/hooks/useTabUrl";
import { CaptureConnectTab } from "./tabs/CaptureConnectTab";
import { AllianceBattleTab } from "./tabs/AllianceBattleTab";
import { BattleHistoryTab } from "./tabs/BattleHistoryTab";
import { BattleDetailTab } from "./tabs/BattleDetailTab";
import { DebugStatsTab } from "./tabs/DebugStatsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatErrorMessage } from "@/lib/format";
import { isTauriRuntime } from "@/lib/runtime";

const TABS: Array<{ id: TabId; label: string; icon: typeof Network }> = [
  { id: "capture", label: "采集连接", icon: Network },
  { id: "alliance", label: "同盟战报", icon: ShieldEllipsis },
  { id: "history", label: "战报库", icon: History },
  { id: "battle", label: "战报详情", icon: ScrollText },
  { id: "stats", label: "调试", icon: BarChart3 },
];

export type BattleGrabberAppProps = {
  workspaceContext: {
    workspaceId: number;
    allianceId: number | null;
    allianceName: string;
    allianceGameId: string | null;
  } | null;
};

function isDesktopRuntime(): boolean {
  return isTauriRuntime();
}

export function BattleGrabberApp(props: BattleGrabberAppProps) {
  const desktopRuntime = isDesktopRuntime();
  const {
    snapshot, setSnapshot, liveAllianceRecordCount, setLiveAllianceRecordCount,
    appendClientLog, refreshSnapshot, connectionReady,
  } = useBattleSnapshot(desktopRuntime);
  const [selectedTab, setSelectedTab] = useTabUrl<TabId>("tab", "capture");
  const [allianceMatchupFilterKey, setAllianceMatchupFilterKey] = useState("");
  const [allianceNameFilter, setAllianceNameFilter] = useState("");

  useLineupSync(snapshot.allianceRecords, props.workspaceContext, desktopRuntime, appendClientLog);

  const {
    currentReports, allReports, usefulSessions, emptySessions,
    selectedReport, selectedReportId, setSelectedReportId,
    selectedSessionId, setSelectedSessionId,
    setFocusedReportSessionId,
    visibleReports, visibleReportSessionId, loadingReport,
    reportDetails, parsedBattleDetails,
    summaryEventTypes, summaryTopSkills, summaryTopUnits,
    resetReportFocus, resetReportSelection,
  } = useReportBrowser(snapshot, selectedTab, desktopRuntime, appendClientLog);

  const {
    processes, workspaces, selectedProcess, setSelectedProcess,
    captureMode, setCaptureMode, workspaceDraft, setWorkspaceDraft, busy,
    refreshProcesses, refreshWorkspaces, applyScanWorkspaceSetting,
    connect, startAllianceListener, disconnect,
  } = useCaptureControls({
    desktopRuntime, setSnapshot, setLiveAllianceRecordCount, appendClientLog,
    refreshSnapshot, resetReportFocus, resetReportSelection,
    setAllianceNameFilter, setAllianceMatchupFilterKey, setSelectedTab,
  });

  async function openReportFolder(report: ReportRecord | null): Promise<void> {
    if (!report) { appendClientLog("warn", "请先选择一份战报。"); return; }
    const folder = getReportFolder(report);
    if (!folder) { appendClientLog("warn", "这份战报没有可打开的本地路径。"); return; }
    if (!desktopRuntime) { appendClientLog("warn", "浏览器预览模式无法打开本地文件夹。"); return; }
    try { await invoke("battle_grabber_open_path", { path: folder }); } catch (e) { appendClientLog("error", `打开战报文件夹失败: ${formatErrorMessage(e)}`); }
  }

  useEffect(() => { if (selectedTab === "alliance") void refreshSnapshot(); }, [refreshSnapshot, selectedTab]);

  const totalReports = currentReports.length;
  const battleLibraryCount = allReports.length;
  const allianceCount = Math.max(snapshot.allianceRecords.length, liveAllianceRecordCount);
  const workspaceSwitchDisabled = busy || connectionReady;
  const workspaceChanged = workspaceDraft.trim() !== snapshot.scanWorkspace;

  return (
    <div className="h-full bg-background text-foreground">
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as TabId)} className="flex h-full min-h-0 flex-col">
        {/* I1：工作区提示条——区分「数据工作区」与「采集输出目录」两个概念 */}
        {props.workspaceContext && (
          <div className="flex items-center gap-2 border-b bg-brand-soft/60 px-6 py-1.5 text-caption text-brand-soft-foreground">
            <ShieldEllipsis size={14} className="shrink-0" />
            当前数据工作区：{props.workspaceContext.allianceName || "未命名"} — 采集输出目录独立于此，见「采集连接」页。
          </div>
        )}
        <div className="border-b bg-background px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <TabsList>
              {TABS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={cn("h-2.5 w-2.5 rounded-full", connectionReady ? "bg-success" : "bg-muted-foreground")} />
                <span className="text-sm">{connectionReady ? "已连接" : "未连接"}{snapshot.connection.process?.name ? ` · ${snapshot.connection.process.name}` : ""}</span>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline">实时报告 {formatCount(totalReports)}</Badge>
                <Badge variant="outline">战报库 {formatCount(battleLibraryCount)}</Badge>
                <Badge variant="outline">同盟记录 {formatCount(allianceCount)}</Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
          <TabsContent value="capture" className="mt-0">
            <CaptureConnectTab
              snapshot={snapshot} workspaceDraft={workspaceDraft} setWorkspaceDraft={setWorkspaceDraft}
              workspaces={workspaces} selectedProcess={selectedProcess} setSelectedProcess={setSelectedProcess}
              captureMode={captureMode} setCaptureMode={setCaptureMode} busy={busy} connectionReady={connectionReady}
              processes={processes} workspaceSwitchDisabled={workspaceSwitchDisabled} workspaceChanged={workspaceChanged}
              applyScanWorkspaceSetting={applyScanWorkspaceSetting} refreshWorkspaces={refreshWorkspaces}
              refreshProcesses={refreshProcesses} connect={connect} disconnect={disconnect}
            />
          </TabsContent>
          <TabsContent value="alliance" className="mt-0">
            <AllianceBattleTab
              allianceRecords={snapshot.allianceRecords} allianceCount={allianceCount} scanWorkspace={snapshot.scanWorkspace}
              allianceNameFilter={allianceNameFilter} setAllianceNameFilter={setAllianceNameFilter}
              allianceMatchupFilterKey={allianceMatchupFilterKey} setAllianceMatchupFilterKey={setAllianceMatchupFilterKey}
              busy={busy} connectionReady={connectionReady}
              desktopRuntime={desktopRuntime} appendClientLog={appendClientLog}
              startAllianceListener={startAllianceListener} disconnect={disconnect} refreshSnapshot={refreshSnapshot}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <BattleHistoryTab
              allReports={allReports} usefulSessions={usefulSessions} emptySessions={emptySessions}
              selectedReport={selectedReport} selectedReportId={selectedReportId} selectedSessionId={selectedSessionId}
              setSelectedSessionId={setSelectedSessionId} setFocusedReportSessionId={setFocusedReportSessionId}
              setSelectedReportId={setSelectedReportId} setSelectedTab={setSelectedTab}
              refreshSnapshot={refreshSnapshot} openReportFolder={openReportFolder}
            />
          </TabsContent>
          <TabsContent value="battle" className="mt-0">
            <BattleDetailTab
              visibleReports={visibleReports} visibleReportSessionId={visibleReportSessionId}
              selectedReportId={selectedReportId} setSelectedReportId={setSelectedReportId}
              setFocusedReportSessionId={setFocusedReportSessionId} selectedReport={selectedReport}
              reportDetails={reportDetails} parsedBattleDetails={parsedBattleDetails}
              loadingReport={loadingReport} openReportFolder={openReportFolder}
            />
          </TabsContent>
          <TabsContent value="stats" className="mt-0">
            <DebugStatsTab
              selectedReport={selectedReport} reportDetails={reportDetails}
              summaryEventTypes={summaryEventTypes} summaryTopSkills={summaryTopSkills} summaryTopUnits={summaryTopUnits}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
