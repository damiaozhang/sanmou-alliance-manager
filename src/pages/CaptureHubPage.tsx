// 采集中心薄壳（阶段4）：数据自取 + pages/capture/ 子组件装配，不再接收 App 下钻 props

import React, { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useAppData, useRefreshAppData } from "@/app/queries";
import { useCaptureSessionControls } from "@/features/capture/useCaptureSessionControls";
import { useTabUrl } from "@/hooks/useTabUrl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHead } from "@/components/PageHead";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCaptureSessions } from "./capture/useCaptureSessions";
import { ManualCaptureTab } from "./capture/ManualCaptureTab";
import { SessionHistoryTab } from "./capture/SessionHistoryTab";
import { CaptureRecordTab } from "./capture/CaptureRecordTab";

export const CaptureHubPage = React.memo(function CaptureHubPage() {
  // 阶段4：页面自取数据与动作，不再接收 App 下钻的 bundle/collector/onStart/onStop props
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { bundle, collector } = useAppData(selectedWorkspaceId);
  const refreshAppData = useRefreshAppData();
  const { startCapture, stopCapture } = useCaptureSessionControls();

  const onRefresh = useCallback(
    () => refreshAppData(selectedWorkspaceId),
    [refreshAppData, selectedWorkspaceId],
  );
  const { sessions, markSessionStarted, clearOptimistic } = useCaptureSessions(bundle, onRefresh);

  const [activeTab, setActiveTab] = useTabUrl<"manual" | "records" | "history">("tab", "manual");
  const [startPending, setStartPending] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const collectorBusy = collector?.runtimeProbe?.busy === true;

  const onStart = useCallback(
    async (captureType: string) => {
      const res = await startCapture(captureType);
      // P1-1 修复：只有真正成功（ok 且拿到 sessionId）才插入乐观会话，
      // 否则（如浏览器预览模式 mock 返回 failed）不插占位，避免永久 running 假会话。
      if (res.ok && res.sessionId != null) markSessionStarted(res.sessionId, captureType);
      return res;
    },
    [markSessionStarted, startCapture],
  );

  const handleStart = useCallback(
    async (captureType: string) => {
      if (startPending) return false;
      setStartPending(true);
      try {
        const { ok } = await onStart(captureType);
        return ok;
      } finally {
        setStartPending(false);
      }
    },
    [onStart, startPending],
  );

  const handleStop = useCallback(async () => {
    if (stopPending) return;
    setStopPending(true);
    try {
      clearOptimistic();
      await stopCapture();
      await onRefresh();
    } finally {
      setStopPending(false);
    }
  }, [clearOptimistic, onRefresh, stopCapture, stopPending]);

  // 页头主操作与历史空态 CTA 共用同一个启动入口（每页恰 1 个 primary）
  const startAllianceCapture = useCallback(() => {
    void handleStart("alliance_data");
  }, [handleStart]);

  return (
    <div className="p-5">
      <PageHead
        title="同盟快照"
        description="数据采集：同盟快照（成员/设施/日志）为「单次采集」模式——点一次采集一轮，采完自动停止并记录；与战报采集（抓取游戏战报）相互独立。"
        actions={
          <Button disabled={collectorBusy || startPending} onClick={startAllianceCapture}>
            <Play size={16} className="mr-2" />
            采集同盟数据
          </Button>
        }
      />
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "manual" | "records" | "history")}>
        <TabsList>
          <TabsTrigger value="manual">单次采集</TabsTrigger>
          <TabsTrigger value="records">采集记录</TabsTrigger>
          <TabsTrigger value="history">会话历史</TabsTrigger>
        </TabsList>
        {/* 三个 TabsContent 全部 forceMount：radix 默认卸载非激活 tab 内容，
            会杀死页面级兜底定时器——保持「页面级存活、路由离开才清理」语义。
            注意 radix-tabs 1.1 在 forceMount 下 present 恒为 true、不下发 hidden 属性，
            非激活可见性需由 data-[state=inactive]:hidden 兜底 */}
        <TabsContent value="manual" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <ManualCaptureTab
            sessions={sessions}
            collectorBusy={collectorBusy}
            stopPending={stopPending}
            onOpenStopConfirm={() => setStopConfirmOpen(true)}
          />
        </TabsContent>
        <TabsContent value="records" forceMount className="data-[state=inactive]:hidden">
          <CaptureRecordTab onCapture={onStart} />
        </TabsContent>
        <TabsContent value="history" forceMount className="data-[state=inactive]:hidden">
          <SessionHistoryTab
            sessions={sessions}
            onStartAlliance={startAllianceCapture}
            workspaceId={selectedWorkspaceId}
            onDeleted={() => {
              void onRefresh();
            }}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={stopConfirmOpen}
        onOpenChange={setStopConfirmOpen}
        title="停止采集？"
        description="停止后当前采集将终止，已采集的数据会保留。"
        confirmText="停止采集"
        onConfirm={() => {
          setStopConfirmOpen(false);
          void handleStop();
        }}
      />
    </div>
  );
});
