import React from "react";
import { Activity, Download, MonitorDot } from "lucide-react";
import type { AppBundle, CollectorStatus, WorkspaceSummary } from "../tauri";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { useAppData, useRefreshAppData } from "@/app/queries";
import { useAppStore } from "@/store/appStore";

export type DiagnosticsProps = {
  summary: WorkspaceSummary | null;
  collector: CollectorStatus | null;
  bundle: AppBundle | null;
  onRefresh: () => Promise<AppBundle | null>;
};

/** 诊断内容（可嵌入设置页或独立渲染，I6 收敛后由设置页承载） */
export function DiagnosticsContent({ summary, bundle, collector, onRefresh }: DiagnosticsProps) {
  const rawArtifacts = bundle?.rawArtifacts ?? [];
  // 阶段3b：大表不再随 bundle 下发，快照计数改读 summary 统计表
  const memberSnapshotCount = summary?.memberSnapshotCount ?? 0;
  const buildingSnapshotCount = summary?.buildingSnapshotCount ?? 0;
  const exportJobs = bundle?.exportJobs ?? [];
  const runtimeProbe = collector?.runtimeProbe;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="记录文件" value={rawArtifacts.length} />
        <MetricCard label="成员快照" value={memberSnapshotCount} />
        <MetricCard label="设施快照" value={buildingSnapshotCount} />
        <MetricCard label="导出任务" value={exportJobs.length} />
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MonitorDot size={18} />
            运行检查
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>就绪</TableCell>
                <TableCell>
                  <Badge variant={runtimeProbe?.ready ? "success" : "warning"}>
                    {runtimeProbe?.ready ? "已就绪" : "未就绪"}
                  </Badge>
                </TableCell>
                <TableCell>{runtimeProbe?.mode ?? "-"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>进程</TableCell>
                <TableCell>
                  <Badge variant={runtimeProbe?.processFound ? "success" : "warning"}>
                    {runtimeProbe?.processFound ? "已找到" : "未找到"}
                  </Badge>
                </TableCell>
                <TableCell>{runtimeProbe?.processTarget ?? "-"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>脚本</TableCell>
                <TableCell>
                  <Badge variant={runtimeProbe?.scriptExists ? "default" : "destructive"}>
                    {runtimeProbe?.scriptExists ? "已找到" : "未找到"}
                  </Badge>
                </TableCell>
                <TableCell>{runtimeProbe?.scriptPath ?? "-"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Python 环境</TableCell>
                <TableCell>
                  <Badge variant={runtimeProbe?.fridaAvailable ? "default" : "destructive"}>
                    {runtimeProbe?.fridaAvailable ? "可用" : "不可用"}
                  </Badge>
                </TableCell>
                <TableCell>{runtimeProbe?.python ?? "-"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>问题</TableCell>
                <TableCell>
                  <Badge variant={runtimeProbe?.issues?.length ? "destructive" : "default"}>
                    {runtimeProbe?.issues?.length ?? 0}
                  </Badge>
                </TableCell>
                <TableCell>{runtimeProbe?.issues?.join(" / ") || "-"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download size={18} />
            导出任务
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>格式</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>输出</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exportJobs.length === 0 ? (
                <EmptyTableRow colSpan={5} title="暂无导出任务。" />
              ) : (
                exportJobs.slice(0, 5).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.jobKind}</TableCell>
                    <TableCell>{job.format}</TableCell>
                    <TableCell>{job.target}</TableCell>
                    <TableCell>
                      <Badge variant={job.status === "success" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{job.outputPaths.join(" / ")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button onClick={() => void onRefresh()}>
        <Activity size={16} className="mr-2" />
        刷新
      </Button>
    </div>
  );
}

export const Diagnostics = React.memo(function Diagnostics() {
  // 阶段4：页面自取数据，不再接收 App 下钻 props
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { summary, collector, bundle } = useAppData(selectedWorkspaceId);
  const refreshAppData = useRefreshAppData();
  const onRefresh = () => refreshAppData(selectedWorkspaceId);
  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorDot size={18} />
            运行状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DiagnosticsContent summary={summary} collector={collector} bundle={bundle} onRefresh={onRefresh} />
        </CardContent>
      </Card>
    </PageShell>
  );
});
