import React, { useCallback, useState, useMemo } from "react";
import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { MemberSnapshotRow } from "../tauri";
import {
  type AllianceDisplayMember,
  applyLegionLabels,
  buildAllianceDisplayMember,
  normalizeMemberFilterValue,
  buildMemberFilterOptions,
  isAllianceMemberOnline,
} from "@/features/alliance/members";
import { type NormalizedFacility, normalizeFacility } from "@/features/alliance/facilities";
import { preferredCaptureSessionId, rowsForCaptureSession, sessionRuntimeRecordCount } from "@/lib/labels";
import { previewOrEmpty } from "@/lib/format";
import { formatCaptureRecordTime } from "@/lib/dates";
import { ALLIANCE_SCANNING_EMPTY } from "../lib/labels";
import { useAppData } from "@/app/queries";
import { useAppStore } from "@/store/appStore";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { useExportActions } from "@/features/export/useExportActions";
import { useMemberBindingActions } from "@/features/alliance/useMemberBindingActions";
import { ROUTE_PATHS } from "@/app/routes";
import { useMemberSnapshotsPaged } from "@/app/queries";
import { useTabUrl } from "@/hooks/useTabUrl";
import { useUrlState } from "@/hooks/useUrlState";
import { ExportMenu } from "@/components/ExportMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableCell } from "@/components/ui/table";
import { EnhancedTable } from "@/components/EnhancedTable";
import { MembersTab } from "./alliance/MembersTab";
import { WeeklyTab } from "./alliance/WeeklyTab";
import { IntelTab } from "./alliance/IntelTab";
import { CargoTab } from "./alliance/CargoTab";
import { LogsTab } from "./alliance/LogsTab";
import { FacilitiesTab } from "./alliance/FacilitiesTab";
import { AlertsTab } from "./alliance/AlertsTab";
import { BindingTab } from "./alliance/BindingTab";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHead } from "@/components/PageHead";

type AllianceDataTabKey =
  "members" | "weekly" | "intel" | "cargo" | "logs" | "facilities" | "groups" | "alerts" | "binding";

// 空态用模块级常量，保证引用稳定
const EMPTY_MEMBER_SNAPSHOT_ROWS: MemberSnapshotRow[] = [];

export const AllianceDataPage = React.memo(function AllianceDataPage() {
  // 阶段4：页面自取数据与动作，不再接收 App 下钻的 bundle props
  const { workspaceId, allianceId } = useActiveWorkspaceContext();
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { bundle } = useAppData(selectedWorkspaceId);
  const { exportActions } = useExportActions();
  const onExportJson = exportActions.allianceJson;
  const onExportCsv = exportActions.allianceCsv;
  const onExportXlsx = exportActions.allianceXlsx;
  const onExportHtml = exportActions.allianceHtml;
  const onExportMemberDataCsv = exportActions.allianceMemberCsv;
  const { saveMemberBinding: onSaveBinding, autoBindMembers: onAutoBind } = useMemberBindingActions(allianceId);
  const navigate = useNavigate();
  const onPlayerClick = useCallback((avatarId: string) => navigate(`/player/${avatarId}`), [navigate]);
  const [legionFilter, setLegionFilter] = useUrlState("legion");
  const [professionFilter, setProfessionFilter] = useUrlState("profession");
  const [onlineFilter, setOnlineFilter] = useUrlState("online", "all");
  const [activeAllianceTab, setActiveAllianceTab] = useTabUrl<AllianceDataTabKey>("tab", "members");
  const [alertsCount, setAlertsCount] = useState<number | null>(null);
  const [logsCount, setLogsCount] = useState<number | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  async function runExport(action: () => void) {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await Promise.resolve(action());
    } finally {
      setExportBusy(false);
    }
  }

  // 阶段3b：成员快照改走 get_member_snapshots 分页命令（latestOnly=true → 每成员最新一行，
  // total 为去重成员数）；日志改由 LogsTab 内部分页查询自供；设施直接用 bundle.allianceFacilities。
  const memberSnapshotsQuery = useMemberSnapshotsPaged(workspaceId, true, { limit: 500, offset: 0 });
  const memberSnapshots = memberSnapshotsQuery.data?.rows ?? EMPTY_MEMBER_SNAPSHOT_ROWS;
  const allianceSessions = useMemo(() => bundle?.captureSessions ?? [], [bundle]);
  const allianceGroups = previewOrEmpty(bundle?.allianceGroups);

  const session = useMemo(() => {
    const allianceSessionsForType = allianceSessions.filter((s) => s.captureType === "alliance_data");
    const latestAllianceSession = allianceSessionsForType[0] ?? null;
    const latestRuntimeAllianceSession =
      allianceSessionsForType.find((s) => s.summary?.collector === "runtime_probe") ?? null;
    // 会话选择（单次采集模式）：优先最新「已完成且采到数据」的 runtime 会话；
    // 0 条记录的失败会话不覆盖已有数据的会话（避免前端显示被清空/不更新）。
    const latestCompletedRuntimeAllianceSession =
      allianceSessionsForType.find(
        (s) => s.summary?.collector === "runtime_probe" && s.status === "completed" && sessionRuntimeRecordCount(s) > 0,
      ) ?? null;
    const latestRuntimeWithData =
      latestCompletedRuntimeAllianceSession ??
      allianceSessionsForType.find(
        (s) => s.summary?.collector === "runtime_probe" && sessionRuntimeRecordCount(s) > 0,
      ) ??
      null;
    const allianceCaptureRunning =
      latestAllianceSession?.status === "running" && latestAllianceSession.summary?.collector === "runtime_probe";
    // 有数据的会话优先；仅在完全没有数据时退到最新会话（此时展示采集状态/空态）
    const activeAllianceSession =
      latestRuntimeWithData ?? latestRuntimeAllianceSession ?? latestAllianceSession ?? null;
    const activeAllianceSessionId = activeAllianceSession?.id ?? null;
    const preferredRuntimeSessionId = latestRuntimeWithData?.id ?? null;
    const latestRuntime = latestRuntimeAllianceSession?.summary?.capture?.runtime;
    const latestRuntimeRecordCount =
      latestRuntime && typeof latestRuntime.recordCount === "number" ? latestRuntime.recordCount : null;
    const latestAllianceCaptureTime = latestAllianceSession
      ? new Date(latestAllianceSession.finishedAt ?? latestAllianceSession.startedAt).toLocaleString("zh-CN")
      : "-";
    return {
      latestRuntimeAllianceSession,
      allianceCaptureRunning,
      activeAllianceSessionId,
      preferredRuntimeSessionId,
      latestRuntimeRecordCount,
      latestAllianceCaptureTime,
    };
  }, [allianceSessions]);

  const { filteredMembers, legionOptions, professionOptions, membersTotal } = useMemo(() => {
    // latestOnly=true 已是每成员最新行，无需再按会话过滤
    const activeMemberSnapshots = memberSnapshots;
    const fallbackMembers: AllianceDisplayMember[] = previewOrEmpty(bundle?.allianceMembers).map((item) =>
      buildAllianceDisplayMember({
        avatarId: item.avatarId,
        name: item.name,
        official: item.official,
        profession: item.profession,
        isOnline: item.isOnline,
        legion: item.legion,
        prosperity: item.prosperity,
        contribution: item.contribution,
        merit: item.merit,
        seasonScore: item.seasonScore,
        lastOfflineTs: item.lastOfflineTs,
        joinTs: item.joinTs,
        tFeat: item.tFeat,
        tForageUse: item.tForageUse,
        wForageUse: item.wForageUse,
        weeklyStatisticsJson: item.weeklyStatisticsJson,
        demolition: item.demolition,
        coord: item.coord,
        status: item.status,
      }),
    );
    const runtimeMembers: AllianceDisplayMember[] = activeMemberSnapshots.map((item) =>
      buildAllianceDisplayMember({
        avatarId: item.avatarId,
        name: item.avatarName,
        official: item.officialName,
        profession: item.professionName,
        isOnline: item.isOnline,
        legion: item.legionName,
        legionId: item.legionId,
        prosperity: item.prosperity,
        contribution: item.weeklyContribution,
        merit: item.weeklyMerit,
        seasonScore: item.seasonScore,
        lastOfflineTs: item.lastOfflineTs,
        joinTs: item.joinTs,
        tFeat: item.tFeat,
        tForageUse: item.tForageUse,
        wForageUse: item.wForageUse,
        weeklyStatisticsJson: item.weeklyStatisticsJson,
        demolition: item.demolitionValue,
        coord: `${item.coordinateX},${item.coordinateY}`,
        status: item.state,
      }),
    );
    // P1-4 修复：游戏侧 legion_name 经常为空、legion_id 才可靠，这里按 id
    // 把缺失的军团名补齐，否则「分组」列与筛选项会大面积显示「- / 未分配」。
    const membersRaw = applyLegionLabels(runtimeMembers.length > 0 ? runtimeMembers : fallbackMembers);
    const legionOptions = buildMemberFilterOptions(membersRaw, (m) => m.legion, "未分配");
    const professionOptions = buildMemberFilterOptions(membersRaw, (m) => m.profession, "未设置");
    const filteredMembers = membersRaw.filter((member) => {
      const legion = normalizeMemberFilterValue(member.legion);
      const profession = normalizeMemberFilterValue(member.profession);
      const isOnline = isAllianceMemberOnline(member);
      return (
        (!legionFilter || legion === legionFilter) &&
        (!professionFilter || profession === professionFilter) &&
        (onlineFilter === "all" || (onlineFilter === "online" && isOnline) || (onlineFilter === "offline" && !isOnline))
      );
    });
    return { filteredMembers, legionOptions, professionOptions, membersTotal: membersRaw.length };
  }, [bundle, memberSnapshots, legionFilter, professionFilter, onlineFilter]);

  // 阶段3b：buildingSnapshots 不再随 bundle 下发（无分页命令），设施展示直接用 allianceFacilities
  const facilities = useMemo<NormalizedFacility[]>(
    () =>
      previewOrEmpty(bundle?.allianceFacilities)
        .map((item) => ({ ...item }))
        .map(normalizeFacility)
        .filter((item): item is NormalizedFacility => item !== null),
    [bundle],
  );

  const activeAllianceGroups = useMemo(
    () =>
      rowsForCaptureSession(
        allianceGroups,
        preferredCaptureSessionId(allianceGroups, session.preferredRuntimeSessionId) ?? session.activeAllianceSessionId,
      ),
    [allianceGroups, session],
  );

  const memberCount = filteredMembers.length;
  const onlineCount = filteredMembers.filter(isAllianceMemberOnline).length;
  const kpis = [
    { label: "成员数", value: memberCount > 0 ? memberCount.toLocaleString("zh-CN") : "—", big: true },
    { label: "在线", value: memberCount > 0 ? onlineCount.toLocaleString("zh-CN") : "—", big: true },
    { label: "最后采集时间", value: session.latestAllianceCaptureTime, big: false },
  ];
  const allianceDataTabs: Array<{ key: AllianceDataTabKey; label: string; count: number | null }> = [
    { key: "members", label: "成员列表", count: filteredMembers.length },
    { key: "weekly", label: "周维度", count: filteredMembers.filter((m) => m.weeklySummary?.current).length },
    { key: "intel", label: "同盟情报", count: null },
    { key: "cargo", label: "辎重", count: filteredMembers.length },
    { key: "logs", label: "同盟日志", count: logsCount },
    { key: "facilities", label: "同盟设施", count: facilities.length },
    { key: "groups", label: "同盟分组", count: activeAllianceGroups.length },
    { key: "alerts", label: "活跃预警", count: alertsCount },
    { key: "binding", label: "成员绑定", count: previewOrEmpty(bundle?.memberBindings).length },
  ];

  return (
    <div className="p-5">
      <PageHead
        title="同盟数据"
        description="成员、辎重、日志、设施与绑定的一页视图。"
        actions={
          <>
            {/* 本页无采集触发回调（props 不含 onCapture），主操作跳采集中心发起——方案 R6「主操作采集数据」的可达实现 */}
            <Button onClick={() => navigate(ROUTE_PATHS.capture)}>
              <Play size={16} className="mr-2" />
              采集数据
            </Button>
            <ExportMenu
              items={[
                { label: "JSON", onSelect: () => runExport(onExportJson) },
                { label: "CSV", onSelect: () => runExport(onExportCsv) },
                { label: "XLSX", onSelect: () => runExport(onExportXlsx) },
                { label: "HTML", onSelect: () => runExport(onExportHtml) },
                { label: "成员 CSV", onSelect: () => runExport(onExportMemberDataCsv) },
              ]}
              busy={exportBusy}
            />
          </>
        }
      />

      {/* KPI 条：一条 hairline 横排，不各自套卡（基调 §3/§4） */}
      <section className="surface-card mb-4 grid grid-cols-3 divide-x divide-[var(--hair)] overflow-hidden">
        {kpis.map((item) => (
          <div key={item.label} className="px-4 py-3">
            <p className="text-xs tracking-wide text-muted-foreground">{item.label}</p>
            <p
              className={
                item.big
                  ? "mt-1 text-metric font-semibold tabular-nums"
                  : "mt-1 truncate text-sm font-medium tabular-nums"
              }
              title={item.value}
            >
              {item.value}
            </p>
          </div>
        ))}
      </section>

      {session.latestRuntimeAllianceSession && session.latestRuntimeRecordCount === 0 && (
        <ErrorState message="Runtime dump 返回 0 条记录。采集时请在客户端打开/刷新同盟成员、日志或设施界面，并等待 dump 完成后再停止。" />
      )}

      <Tabs value={activeAllianceTab} onValueChange={(v) => setActiveAllianceTab(v as AllianceDataTabKey)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            {allianceDataTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}{" "}
                {tab.count !== null && (
                  <Badge variant="secondary" className="ml-1">
                    {tab.count}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="members">
          <MembersTab
            members={filteredMembers}
            onPlayerClick={onPlayerClick}
            legionFilter={legionFilter}
            setLegionFilter={setLegionFilter}
            professionFilter={professionFilter}
            setProfessionFilter={setProfessionFilter}
            onlineFilter={onlineFilter}
            setOnlineFilter={setOnlineFilter}
            legionOptions={legionOptions}
            professionOptions={professionOptions}
            allianceCaptureRunning={session.allianceCaptureRunning}
            totalCount={membersTotal}
          />
        </TabsContent>

        <TabsContent value="weekly">
          <WeeklyTab members={filteredMembers} allianceCaptureRunning={session.allianceCaptureRunning} />
        </TabsContent>

        <TabsContent value="intel">
          <IntelTab allianceCaptureRunning={session.allianceCaptureRunning} />
        </TabsContent>

        <TabsContent value="cargo">
          <CargoTab members={filteredMembers} allianceCaptureRunning={session.allianceCaptureRunning} />
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab workspaceId={workspaceId} onCountChange={setLogsCount} />
        </TabsContent>

        <TabsContent value="facilities">
          <FacilitiesTab facilities={facilities} />
        </TabsContent>

        <TabsContent value="groups">
          {activeAllianceGroups.length === 0 ? (
            <EmptyState
              title={session.allianceCaptureRunning ? ALLIANCE_SCANNING_EMPTY : "当前工作区暂无同盟分组数据。"}
              action={
                session.allianceCaptureRunning
                  ? undefined
                  : { label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }
              }
            />
          ) : (
            <EnhancedTable
              columns={["分组ID", "分组名", "同盟ID", "同盟名", "成员数", "采集时间"]}
              rows={activeAllianceGroups}
              density="compact"
              renderRow={(item) => (
                <>
                  <TableCell className="tabular-nums">{item.groupId || "-"}</TableCell>
                  <TableCell>{item.groupName || "-"}</TableCell>
                  <TableCell className="tabular-nums">{item.legionId || "-"}</TableCell>
                  <TableCell>{item.legionName || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.memberCount || 0}</TableCell>
                  <TableCell className="tabular-nums">{formatCaptureRecordTime(item.observedAt)}</TableCell>
                </>
              )}
            />
          )}
        </TabsContent>

        <TabsContent value="alerts">
          <AlertsTab workspaceId={workspaceId} onCountChange={setAlertsCount} />
        </TabsContent>

        <TabsContent value="binding">
          <BindingTab bundle={bundle} onSaveBinding={onSaveBinding} onAutoBind={onAutoBind} />
        </TabsContent>
      </Tabs>
    </div>
  );
});
