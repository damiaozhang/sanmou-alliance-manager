// 「采集记录」tab：单次采集执行记录视图（阶段4 迁入 pages/capture/，内容不变）

import React, { useState } from "react";
import { isTauriRuntime } from "../../tauri";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { captureTypeLabel } from "../../lib/labels";

const sectionTitleClass = "text-xs font-medium tracking-wide text-muted-foreground";

/** 单次采集执行记录视图：展示最近一次采集的即时结果与采集说明。 */
export const CaptureRecordTab = React.memo(function CaptureRecordTab({
  onCapture,
}: {
  onCapture: (captureType: string) => Promise<{ ok: boolean; sessionId?: number }>;
}) {
  const tauriRuntime = isTauriRuntime();
  const [capturePending, setCapturePending] = useState(false);
  const [lastResult, setLastResult] = useState<{
    time: string;
    type: string;
    ok: boolean;
    note: string;
  } | null>(null);

  if (!tauriRuntime) {
    return (
      <EmptyState title="请在桌面应用中使用单次采集。浏览器预览模式无法启动采集会话。" />
    );
  }

  async function handleCaptureOnce(): Promise<void> {
    if (capturePending) return;
    setCapturePending(true);
    const time = new Date().toLocaleString("zh-CN");
    try {
      const { ok, sessionId } = await onCapture("alliance_data");
      setLastResult({
        time,
        type: "alliance_data",
        ok,
        note: ok
          ? `采集已启动${sessionId != null ? `（会话 ${sessionId}）` : ""}，完成后会自动停止`
          : "采集启动失败",
      });
    } catch {
      setLastResult({ time, type: "alliance_data", ok: false, note: "调用异常" });
    } finally {
      setCapturePending(false);
    }
  }

  return (
    <Card>
      <CardContent className="divide-y p-6">
        <section className="space-y-2 pb-4">
          <h3 className={sectionTitleClass}>最近一次采集</h3>
          {lastResult ? (
            <p className="text-sm">
              <span className="tabular-nums">{lastResult.time}</span> · {captureTypeLabel(lastResult.type)} ·{" "}
              <Badge variant={lastResult.ok ? "default" : "destructive"}>
                {lastResult.ok ? "成功" : "失败"}
              </Badge>{" "}
              {lastResult.note}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">尚未执行过采集。</p>
          )}
          <div className="pt-1">
            <Button variant="outline" disabled={capturePending} onClick={() => void handleCaptureOnce()}>
              {capturePending ? "采集中..." : "立即采集一轮"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            单次采集模式：点一次采集一轮同盟快照，采集到数据后自动停止，每次执行都会记录。请在采集过程中打开/刷新游戏内的同盟成员、日志或设施界面。
          </p>
        </section>

        <section className="space-y-4 pt-4">
          <h3 className={sectionTitleClass}>采集说明</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>「采集同盟数据」与「立即采集一轮」都会执行一次完整的同盟快照采集。</li>
            <li>采集完成后自动停止，不会周期重复；如需再采一轮，再次点击即可。</li>
            <li>会话历史页保留全部历史记录（含失败记录），方便回溯。</li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
});
