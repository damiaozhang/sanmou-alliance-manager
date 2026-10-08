import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { type BattleReportRow, type MemberSnapshotRow } from "../tauri";
import { dateKey, localDateKey, mondayWeekStart, formatCaptureRecordTime } from "@/lib/dates";
import {
  WORKSPACE_FORM_LABELS,
  attackerOutcomeFromResult,
  captureTypeLabel,
  sortedCaptureSessions,
  captureRecordLabel,
  summarizeSessionNote,
} from "../lib/labels";
import { computeHealth, healthTone } from "@/lib/health";
import { formatErrorMessage } from "@/lib/format";
import { useAppData, useBattleReportsPaged, useAllMemberSnapshots } from "@/app/queries";
import { useAppStore } from "@/store/appStore";
import { useWorkspaceManagement } from "@/features/workspace/useWorkspaceManagement";

import { cn } from "@/lib/utils";
// 版本号单一数据源：package.json（与 sidecar 版本锁定一致）
import { version } from "../../package.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SuspenseFallback } from "@/components/SuspenseFallback";
import { PageHead } from "@/components/PageHead";
import { KpiStrip } from "@/components/KpiStrip";
import { UnitCard } from "@/components/UnitCard";
import { LiveSessionCard } from "@/components/LiveSessionCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BattleWinRateChart } from "@/components/charts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// 空态用模块级常量，保证引用稳定（空查询结果不触发下游无谓重渲染）
const EMPTY_BATTLE_ROWS: BattleReportRow[] = [];
const EMPTY_MEMBER_ROWS: MemberSnapshotRow[] = [];

/** 采集状态中文标签：不再把 running / completed 这类协议原值直接摆给用户看 */
const SESSION_STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  pending: "等待中",
};
const SESSION_STATUS_VARIANT: Record<string, "success" | "info" | "destructive" | "secondary"> = {
  running: "info",
  completed: "success",
  failed: "destructive",
  pending: "secondary",
};

export function WorkspaceCreateFields({
  form,
  setForm,
  nameError,
  setNameError,
  createPending,
  onCreate,
}: {
  form: { name: string; serverName: string; seasonName: string; allianceName: string; allianceGameId: string };
  setForm: (f: typeof form) => void;
  nameError: string;
  setNameError: (v: string) => void;
  createPending: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">{WORKSPACE_FORM_LABELS.name}</Label>
        <Input
          id="ws-name"
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value });
            if (nameError) setNameError("");
          }}
          placeholder={WORKSPACE_FORM_LABELS.name}
        />
        {nameError && <p className="text-caption text-destructive">{nameError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-server">{WORKSPACE_FORM_LABELS.serverName}</Label>
        <Input
          id="ws-server"
          value={form.serverName}
          onChange={(e) => setForm({ ...form, serverName: e.target.value })}
          placeholder={WORKSPACE_FORM_LABELS.serverName}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-season">{WORKSPACE_FORM_LABELS.seasonName}</Label>
        <Input
          id="ws-season"
          value={form.seasonName}
          onChange={(e) => setForm({ ...form, seasonName: e.target.value })}
          placeholder={WORKSPACE_FORM_LABELS.seasonName}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-alliance">{WORKSPACE_FORM_LABELS.allianceName}</Label>
        <Input
          id="ws-alliance"
          value={form.allianceName}
          onChange={(e) => setForm({ ...form, allianceName: e.target.value })}
          placeholder={WORKSPACE_FORM_LABELS.allianceName}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-alliance-id">{WORKSPACE_FORM_LABELS.allianceGameId}</Label>
        <Input
          id="ws-alliance-id"
          value={form.allianceGameId}
          onChange={(e) => setForm({ ...form, allianceGameId: e.target.value })}
          placeholder={WORKSPACE_FORM_LABELS.allianceGameId}
        />
      </div>
      <Button className="w-full" onClick={() => void onCreate()} disabled={createPending}>
        <Play size={16} className="mr-2" />
        {createPending ? "创建中…" : "创建"}
      </Button>
    </div>
  );
}

export const Dashboard = React.memo(function Dashboard() {
  // 阶段4：页面自取数据与动作，不再接收 App 下钻的 bundle props
  const {
    form,
    setForm,
    workspaces,
    activeWorkspace,
    handleCreateWorkspace: onCreateWorkspace,
    handleSelectWorkspace: onSelectWorkspace,
  } = useWorkspaceManagement();
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { bundle, lineupAnalysis, isLoading: appLoading, firstError: appError } = useAppData(selectedWorkspaceId);
  const onNavigate = useNavigate();
  const queryClient = useQueryClient();
  const [nameError, setNameError] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── 阶段3b 分片供数：大表不再随 bundle 下发，改走分页命令（此处用大 limit 拉取分析窗口）──
  const workspaceId = activeWorkspace?.id ?? null;
  const weekStartISO = useMemo(() => mondayWeekStart(new Date()).toISOString(), []);
  // 本周战报（time DESC，[周一, 不限)）：今日战报/本周胜率/胜率趋势共用
  const weekReportsQuery = useBattleReportsPaged(workspaceId, { from: weekStartISO, limit: 500, offset: 0 });
  // 全量战报计数（limit=1 只取 total）：主流程条点亮条件
  const battleCountQuery = useBattleReportsPaged(workspaceId, { limit: 1, offset: 0 });
  // 成员快照历史（全量循环分页，P1-3 修复原 2000 条上限截断）：健康度时间序列
  const memberHistoryQuery = useAllMemberSnapshots(workspaceId);

  // ── S5 同盟健康度：快照时间序列 + 阵容红度 + 采集活跃度（放在早退 return 之前，保证 hooks 顺序稳定）──
  const healthSnapshots = memberHistoryQuery.data ?? EMPTY_MEMBER_ROWS;
  const health = useMemo(
    () => computeHealth(healthSnapshots, lineupAnalysis.stats, bundle?.captureSessions ?? []),
    [healthSnapshots, lineupAnalysis.stats, bundle?.captureSessions]
  );
  const healthToneInfo = healthTone(health.score);

  async function handleCreateWorkspace() {
    if (createPending) return;
    if (!form.name.trim()) {
      setNameError("请填写工作区名称。");
      return;
    }
    setCreatePending(true);
    try {
      await onCreateWorkspace();
    } finally {
      setCreatePending(false);
    }
  }

  /** 手动刷新：按钮进入 pending 态，而不是"点了没反应" */
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  }

  // ── 空工作区态：整页仅创建引导卡 ──
  if (workspaces.length === 0) {
    return (
      <div className="p-5">
        <PageHead title="总览" description="还没有工作区，先创建一个开始记录你的同盟数据。" />
        <div className="flex justify-center pt-6">
          <div className="surface-card w-full max-w-md p-6">
            <div className="mb-4 text-center">
              <div className="mb-2 flex justify-center text-primary/60">
                <EmptyState illustration="beacon" />
              </div>
              <h3 className="text-[15px] font-medium">创建你的第一个工作区</h3>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                工作区聚合一个同盟在一个赛季的全部采集数据，创建后即可开始采集、分析与对比。
              </p>
            </div>
            <WorkspaceCreateFields
              form={form}
              setForm={setForm}
              nameError={nameError}
              setNameError={setNameError}
              createPending={createPending}
              onCreate={handleCreateWorkspace}
            />
          </div>
        </div>
      </div>
    );
  }

  const sessions = sortedCaptureSessions(bundle?.captureSessions);
  // 本地日期口径（S3-1 时区修复）：不经过 toISOString，避免 UTC 偏移算错「今天」
  const todayKey = localDateKey(new Date());
  const weekReports = weekReportsQuery.data?.rows ?? EMPTY_BATTLE_ROWS;
  const todayBattles = weekReports.filter((r) => dateKey(r.time) === todayKey).length;

  // 服务端已按 from=周一过滤，客户端不再重复时间筛选
  const weekBattles = weekReports;
  // 统一胜率口径（平局计半胜，攻击方视角）：分母仅计已知场次 win+loss+draw，
  // unknown（无法判定胜负的战报）不稀释胜率，与 winrate.ts/MatchupTab 一致。
  const weekOutcomes = weekBattles.map((r) => attackerOutcomeFromResult(r.result));
  const weekWins = weekOutcomes.filter((o) => o === "win").length;
  const weekDraws = weekOutcomes.filter((o) => o === "draw").length;
  const weekLosses = weekOutcomes.filter((o) => o === "loss").length;
  const weekKnown = weekWins + weekDraws + weekLosses;
  // 本周无已知场次时胜率为 null → KPI 显示 —（基调 §4：无数据不显示 0）
  const weekWinRate = weekKnown === 0 ? null : Math.round(((weekWins + weekDraws * 0.5) / weekKnown) * 100);

  const snapshots = healthSnapshots;
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    const prev = latest.get(s.avatarId);
    if (!prev || s.observedAt > prev.observedAt) latest.set(s.avatarId, s);
  }
  const onlineCount = [...latest.values()].filter((s) => s.isOnline === 1).length;
  const memberTotal = latest.size;
  const latestCapture =
    sessions.length > 0 ? formatCaptureRecordTime(sessions[0].finishedAt ?? sessions[0].startedAt) : "—";

  // ── 待办口径（S3-1）──
  // 未绑定玩家数 = allianceMembers.avatarId 未被 memberBindings.avatar 覆盖的成员数；
  // 只统计每个 avatar 最新且当前生效（isActive）的绑定，「已停用」视为未覆盖（绑定已解除）。
  const coveredAvatarIds = new Set(
    (bundle?.memberBindings ?? []).filter((b) => b.isActive && b.status !== "已停用").map((b) => b.avatar)
  );
  const unboundCount = (bundle?.allianceMembers ?? []).filter((m) => !coveredAvatarIds.has(m.avatarId)).length;
  const failedSessionCount = (bundle?.captureSessions ?? []).filter((s) => s.status === "failed").length;

  // ── 4 步主流程条：本质是 onboarding，数据齐了就隐藏（不再常驻占用首屏）──
  const hasAllianceData = sessions.some((s) => s.captureType === "alliance_data" && s.status === "completed");
  const hasBattleReports = (battleCountQuery.data?.total ?? 0) > 0;
  const allBound = unboundCount === 0;
  const hasAnalysis = hasBattleReports && sessions.length > 0;
  const needsOnboarding = !hasAllianceData || !hasBattleReports;
  const steps: Array<{ label: string; ready: boolean; target: string; hint: string }> = [
    { label: "采集同盟快照", ready: hasAllianceData, target: "/capture", hint: "成员 / 设施 / 日志" },
    { label: "抓取战报", ready: hasBattleReports, target: "/battle-grabber", hint: "抓取游戏战报" },
    { label: "绑定成员", ready: allBound, target: "/alliance?tab=binding", hint: "成员 ↔ 玩家映射" },
    { label: "查看分析", ready: hasAnalysis, target: "/lineups", hint: "胜率 / 克制 / 排行" },
  ];

  return (
    <div className="p-5">
      <PageHead
        title="总览"
        description={
          activeWorkspace
            ? `${activeWorkspace.name} · ${activeWorkspace.serverName} · ${activeWorkspace.seasonName}　本周采集 ${sessions.length} 次 · 最近 ${latestCapture}`
            : undefined
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
              <RefreshCw size={14} className={cn("mr-1.5", refreshing && "animate-spin")} />
              {refreshing ? "刷新中…" : "刷新"}
            </Button>
            <Button size="sm" onClick={() => onNavigate("/capture")}>
              <Play size={14} className="mr-1.5" />
              采集一轮
            </Button>
          </>
        }
      />

      {appError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-card p-4">
          <ErrorState message={`数据加载失败：${formatErrorMessage(appError)}`} />
        </div>
      )}

      {/* ── 新工作区引导：数据齐了自动隐藏 ── */}
      {needsOnboarding && (
        <section className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {steps.map((step, i) => (
            <button
              key={step.label}
              type="button"
              onClick={() => onNavigate(step.target)}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step.ready ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-card hover:border-primary/25",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                  step.ready ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13px] font-medium", step.ready && "text-primary")}>
                  {step.label}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {step.ready ? "已完成 · 点击进入" : step.hint}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {/* ── KPI 横排：hairline 分隔 + count-up（规格 §3/§4）── */}
      <KpiStrip
        items={[
          { label: "今日战报", value: todayBattles, delta: { text: "今日 00:00 起", tone: "flat" } },
          {
            label: "本周胜率",
            value: weekWinRate ?? 0,
            suffix: "%",
            overrideText: weekWinRate === null ? "—" : undefined,
            delta:
              weekWinRate === null
                ? { text: "本周暂无战报", tone: "flat" }
                : {
                    text: weekWinRate >= 50 ? "▲ 达标" : "▼ 低于半数",
                    tone: weekWinRate >= 50 ? "up" : "down",
                  },
          },
          {
            label: "在线成员",
            value: onlineCount,
            overrideText: memberTotal === 0 ? "—" : undefined,
            delta: { text: `共 ${memberTotal} 人`, tone: "flat" },
          },
          {
            label: "未绑定成员",
            value: unboundCount,
            delta: unboundCount > 0 ? { text: "需要处理", tone: "down" } : { text: "全部已绑定", tone: "up" },
          },
          {
            label: "同盟健康度",
            value: health.score,
            delta: {
              text: healthToneInfo.label,
              tone:
                healthToneInfo.tone === "success" ? "up" : healthToneInfo.tone === "destructive" ? "down" : "flat",
            },
          },
        ]}
      />

      {weekReports.length >= 500 && (
        <p className="mb-4 text-[11.5px] text-muted-foreground">
          本周战报超过 500 条，今日战报与本周胜率基于最近 500 条统计，可能未覆盖全部。
        </p>
      )}

      {/* ── 主网格：左 2/3 趋势+健康度+最近采集，右 1/3 实时会话+待办 ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {hasBattleReports && (
            <UnitCard title="胜率趋势" tag="近 7 天 · 攻方视角">
              <BattleWinRateChart battles={weekReports} days={7} />
            </UnitCard>
          )}
          <UnitCard
            title="同盟健康度"
            action={
              <Badge variant={healthToneInfo.tone}>
                {health.score} 分 · {healthToneInfo.label}
              </Badge>
            }
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {(
                [
                  ["在线趋势", health.facets.onlineTrend, health.notes.onlineTrend],
                  ["平均红度", health.facets.redSpread, health.notes.redSpread],
                  ["人数稳定", health.facets.attritionSlope, health.notes.attritionSlope],
                  ["采集活跃", health.facets.joinLeaveRate, health.notes.joinLeaveRate],
                ] as const
              ).map(([label, value, note]) => (
                <div key={label}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] text-muted-foreground">{label}</span>
                    <span className="text-[12.5px] font-medium tabular-nums">{value}</span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        value >= 75 ? "bg-victory" : value >= 55 ? "bg-info" : value >= 35 ? "bg-warning" : "bg-destructive",
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground" title={note}>
                    {note}
                  </p>
                </div>
              ))}
            </div>
          </UnitCard>
          <UnitCard
            title="最近采集"
            action={
              <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => onNavigate("/capture")}>
                全部
                <ArrowRight size={13} className="ml-1" />
              </Button>
            }
          >
            {sessions.length === 0 ? (
              appLoading ? (
                <SuspenseFallback variant="table" />
              ) : (
                <EmptyState
                  title="还没有采集记录"
                  action={{ label: "去采集中心", onClick: () => onNavigate("/capture") }}
                />
              )
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>记录</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>完成时间</TableHead>
                    <TableHead>摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.slice(0, 6).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-[12px] text-muted-foreground">
                        {captureRecordLabel(s)}
                      </TableCell>
                      <TableCell className="text-[12.5px]">{captureTypeLabel(s.captureType)}</TableCell>
                      <TableCell>
                        <Badge variant={SESSION_STATUS_VARIANT[s.status] ?? "secondary"}>
                          {SESSION_STATUS_LABEL[s.status] ?? s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">
                        {s.finishedAt
                          ? formatCaptureRecordTime(s.finishedAt)
                          : formatCaptureRecordTime(s.startedAt)}
                      </TableCell>
                      <TableCell className="max-w-[380px] truncate text-[12px] text-muted-foreground">
                        {summarizeSessionNote(s)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </UnitCard>
        </div>

        <div className="flex flex-col gap-4">
          <LiveSessionCard
            active={sessions.some((s) => s.status === "running")}
            version={version}
            fetched={0}
            target={0}
            elapsedLabel={latestCapture}
          />
          {(unboundCount > 0 || failedSessionCount > 0) && (
            <UnitCard title="待办" tag="数据齐自动隐藏">
              <div className="space-y-2">
                {unboundCount > 0 && (
                  <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] px-4 py-2.5">
                    <AlertTriangle size={15} className="shrink-0 text-warning" />
                    <span className="text-[13px]">
                      <span className="font-medium tabular-nums">{unboundCount}</span> 位成员未绑定玩家
                      <span className="ml-1.5 text-[12px] text-muted-foreground">绑定后才能做玩家维度分析</span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-[12px]"
                      onClick={() => onNavigate("/alliance?tab=binding")}
                    >
                      去绑定
                    </Button>
                  </div>
                )}
                {failedSessionCount > 0 && (
                  <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-4 py-2.5">
                    <AlertCircle size={15} className="shrink-0 text-destructive" />
                    <span className="text-[13px]">
                      <span className="font-medium tabular-nums">{failedSessionCount}</span> 次采集失败
                      <span className="ml-1.5 text-[12px] text-muted-foreground">查看失败原因并可重试</span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-[12px]"
                      onClick={() => onNavigate("/capture")}
                    >
                      去采集中心
                    </Button>
                  </div>
                )}
              </div>
            </UnitCard>
          )}
        </div>
      </div>

      {/* ── 工作区管理：日常用得少，下沉到页面底部且视觉低调 ── */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] tracking-wide text-muted-foreground">工作区</h3>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-[12px]">
                <Plus size={13} className="mr-1" />
                新建工作区
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建工作区</DialogTitle>
                <DialogDescription>
                  工作区聚合一个同盟在一个赛季的全部采集数据，创建后自动切换过去。
                </DialogDescription>
              </DialogHeader>
              <WorkspaceCreateFields
                form={form}
                setForm={setForm}
                nameError={nameError}
                setNameError={setNameError}
                createPending={createPending}
                onCreate={() => {
                  void handleCreateWorkspace().then(() => setCreateDialogOpen(false));
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
        <div className="surface-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>服务器</TableHead>
                <TableHead>赛季</TableHead>
                <TableHead>同盟</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((ws) => (
                <TableRow
                  key={ws.id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/50",
                    activeWorkspace?.id === ws.id && "bg-accent/50",
                  )}
                  onClick={() => onSelectWorkspace(ws.id)}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2 text-[13px]">
                      {activeWorkspace?.id === ws.id && <Check size={13} className="text-primary" />}
                      {ws.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12.5px]">{ws.serverName}</TableCell>
                  <TableCell className="text-[12.5px]">{ws.seasonName}</TableCell>
                  <TableCell className="text-[12.5px]">{ws.allianceName || "—"}</TableCell>
                  <TableCell className="text-right">
                    {activeWorkspace?.id === ws.id ? <Badge variant="default">当前</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
});
