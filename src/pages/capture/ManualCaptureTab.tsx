// 「单次采集」tab：运行卡 + 战报采集入口（阶段4 自 CaptureHubPage 拆出）

import React, { useEffect, useState } from "react";
import { ArrowRight, Clock3, Square } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { captureTypeLabel, captureStatusBadge } from "../../lib/labels";
import { formatCaptureRecordTime } from "@/lib/dates";
import { ROUTE_PATHS } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type SessionRow = { id: number; captureType: string; status: string; startedAt: string };

function useElapsed(startedAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return "准备中";
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return "进行中";
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

export const ManualCaptureTab = React.memo(function ManualCaptureTab({
  sessions,
  collectorBusy,
  stopPending,
  onOpenStopConfirm,
}: {
  sessions: SessionRow[];
  collectorBusy: boolean;
  stopPending: boolean;
  onOpenStopConfirm: () => void;
}) {
  const navigate = useNavigate();
  // 运行卡：running 会话（含乐观项）或 collector 忙时显示；单次采集执行一轮即自动结束
  const runningSession = sessions.find((s) => s.status === "running") ?? null;
  const showRunningCard = runningSession !== null || collectorBusy;
  const runningBadge = captureStatusBadge("running");
  const elapsed = useElapsed(runningSession?.startedAt);

  if (showRunningCard) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="min-w-[360px] flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={runningBadge.variant}>{runningBadge.label}</Badge>
              <span className="font-medium">{runningSession ? captureTypeLabel(runningSession.captureType) : "-"}</span>
              <span className="ml-auto flex items-center gap-1.5 tabular-nums text-muted-foreground">
                <Clock3 size={13} />
                已用时 {elapsed}
              </span>
            </div>
            <Progress indeterminate className="h-1.5" aria-label="采集正在进行" />
            {collectorBusy && !runningSession && <p className="text-sm text-muted-foreground">采集正在后台执行...</p>}
            {runningSession && (
              <div className="space-y-0.5 text-[12px] text-muted-foreground">
                <p>采集进行中：请在游戏中打开/刷新同盟成员、日志或设施界面，采集到数据后会自动停止。</p>
                <p className="tabular-nums">开始于 {formatCaptureRecordTime(runningSession.startedAt)}</p>
              </div>
            )}
          </div>
          <Button
            variant="destructive"
            disabled={(!collectorBusy && !runningSession) || stopPending}
            onClick={onOpenStopConfirm}
          >
            <Square size={16} className="mr-2" />
            停止
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 战报采集入口收敛（方案 R6）：本页不再直接发起 battle_passive 会话，
          「开始战报采集」改为跳转战报采集页 */}
      <Button variant="outline" onClick={() => navigate(ROUTE_PATHS.battleGrabber)}>
        <ArrowRight size={16} className="mr-2" />
        前往战报采集
      </Button>
      <p className="text-caption text-muted-foreground">
        点一次采一轮同盟快照，采集到数据后自动停止。每次采集都会在「采集记录」留下记录。
      </p>
    </div>
  );
});
