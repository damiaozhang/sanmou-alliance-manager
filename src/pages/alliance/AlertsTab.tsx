import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getMemberActivityAlerts,
  type MemberActivityAlertRow,
  type MemberActivityAlerts,
} from "../../tauri";
import { formatCaptureRecordTime, formatUnixSeconds } from "@/lib/dates";
import { formatErrorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

const OFFLINE_DAY_OPTIONS = [1, 3, 7, 14];
const BOTTOM_N_OPTIONS = [5, 10, 20];

export const AlertsTab = React.memo(function AlertsTab({
  workspaceId,
  onCountChange,
}: {
  workspaceId: number | null;
  onCountChange?: (total: number) => void;
}) {
  const [offlineDays, setOfflineDays] = useState("3");
  const [bottomN, setBottomN] = useState("10");
  const [alerts, setAlerts] = useState<MemberActivityAlerts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // P1-2 修复：请求序号防竞态——参数快速切换时旧响应晚返回直接丢弃，
  // 避免展示与当前参数不匹配的旧数据。
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!workspaceId) {
      seqRef.current += 1;
      setAlerts(null);
      setLoading(false);
      onCountChange?.(0);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await getMemberActivityAlerts(workspaceId, Number(offlineDays), Number(bottomN));
      if (seq !== seqRef.current) return; // 过期响应丢弃
      setAlerts(result);
      onCountChange?.(result.offlineMembers.length + result.lowContribution.length);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setAlerts(null);
      onCountChange?.(0);
      setError(`活跃预警加载失败：${formatErrorMessage(e)}`);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [workspaceId, offlineDays, bottomN, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const offlineMembers = alerts?.offlineMembers ?? [];
  const lowContribution = alerts?.lowContribution ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        按最近采集数据筛选长期未上线成员与周贡献垫底成员，便于及时跟进管理。
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">未上线天数</label>
          <Select value={offlineDays} onValueChange={setOfflineDays}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OFFLINE_DAY_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} 天</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">垫底人数</label>
          <Select value={bottomN} onValueChange={setBottomN}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOTTOM_N_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} 人</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "加载中…" : "刷新"}
        </Button>
      </div>

      {error && <ErrorState message={error} />}
      {!workspaceId && <EmptyState title="请先选择工作区。" />}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          {offlineDays} 天未上线 <Badge variant="secondary" className="ml-1">{offlineMembers.length}</Badge>
        </h3>
        {offlineMembers.length === 0 ? (
          <EmptyState title={alerts ? "暂无长期未上线的成员。" : "暂无数据。"} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>官职</TableHead>
                <TableHead>最后下线时间</TableHead>
                <TableHead>观察时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offlineMembers.map((m: MemberActivityAlertRow) => (
                <TableRow key={`offline-${m.avatarId}`}>
                  <TableCell>{m.avatarName || m.avatarId || "-"}</TableCell>
                  <TableCell>{m.officialName || "-"}</TableCell>
                  <TableCell className="tabular-nums">{formatUnixSeconds(m.lastOfflineTs)}</TableCell>
                  <TableCell className="tabular-nums">{formatCaptureRecordTime(m.observedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          周贡献垫底 <Badge variant="secondary" className="ml-1">{lowContribution.length}</Badge>
        </h3>
        {lowContribution.length === 0 ? (
          <EmptyState title={alerts ? "暂无周贡献垫底成员数据。" : "暂无数据。"} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>周贡献</TableHead>
                <TableHead>周武勋</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowContribution.map((m: MemberActivityAlertRow) => (
                <TableRow key={`low-${m.avatarId}`}>
                  <TableCell>{m.avatarName || m.avatarId || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.weeklyContribution.toLocaleString("zh-CN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.weeklyMerit.toLocaleString("zh-CN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
});
