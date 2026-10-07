import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { MetricCard } from "@/components/MetricCard";
import { TruncatedText } from "@/components/TruncatedText";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { useIntelEntries, useIntelSnapshotsPaged } from "@/app/queries";
import { ROUTE_PATHS } from "@/app/routes";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const EMPTY = "—";

/**
 * 同盟情报（新增采集域）统一视图。
 *
 * 四个域（全服排行榜 / 全服武将红度普查 / 赛季战队 / 主公簿）在后端共用
 * 「快照 + 条目」两张表（`alliance_intel_snapshot` / `alliance_intel_entry`），
 * 前端因此可以用**一套**「选类型 → 选快照 → 看明细」流程渲染，差异只体现在列定义上。
 *
 * 为什么不给每个域做独立页面：这几个域的共同点是「结构多变、字段随赛季演进」，
 * 分页面会让协议调整的改动面乘以 4；统一流程 + 列定义表（INTEL_KINDS）则只改一处。
 */
type IntelKind = "server_rank" | "hero_rating" | "season_team" | "player_profile";

type ColumnSpec = { key: "rank" | "subjectKey" | "name" | "unionName" | "value"; label: string; numeric?: boolean };

const INTEL_KINDS: Array<{ kind: IntelKind; label: string; description: string; columns: ColumnSpec[] }> = [
  {
    kind: "server_rank",
    label: "全服排行榜",
    description: "繁荣 / 武勋 / 首占 / 赛季积分等榜单（按职业分榜）；名次与数值来自榜单协议。",
    columns: [
      { key: "rank", label: "名次", numeric: true },
      { key: "name", label: "玩家" },
      { key: "unionName", label: "同盟" },
      { key: "value", label: "榜单值", numeric: true }
    ]
  },
  {
    kind: "hero_rating",
    label: "武将红度",
    description:
      "全服玩家的武将红度普查；红度分口径为 evolution × 100 + enlighten（与阵容分析一致），≥500 视为满红。",
    columns: [
      { key: "subjectKey", label: "武将 ID" },
      { key: "name", label: "武将" },
      { key: "value", label: "红度分", numeric: true }
    ]
  },
  {
    kind: "season_team",
    label: "赛季战队",
    description: "备战区 / 赛季战队编制与成员；同一队伍多次采集会各存一份快照。",
    columns: [
      { key: "rank", label: "职位", numeric: true },
      { key: "name", label: "成员" },
      { key: "unionName", label: "同盟" },
      { key: "value", label: "势力值", numeric: true }
    ]
  },
  {
    kind: "player_profile",
    label: "主公簿",
    description: "玩家档案（势力值 / 赛季积分 / 功勋等）；来自主公簿与简易数据批量接口。",
    columns: [
      { key: "name", label: "玩家" },
      { key: "unionName", label: "同盟" },
      { key: "value", label: "势力值", numeric: true },
      { key: "subjectKey", label: "玩家 ID" }
    ]
  }
];

function formatMetricValue(value: number, key: ColumnSpec["key"]) {
  if (key === "value" && Number.isInteger(value)) return value.toLocaleString("zh-CN");
  if (key === "value") return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return value ? value.toLocaleString("zh-CN") : EMPTY;
}

export function IntelTab({ allianceCaptureRunning }: { allianceCaptureRunning: boolean }) {
  const navigate = useNavigate();
  const { workspaceId } = useActiveWorkspaceContext();
  const [kind, setKind] = useState<IntelKind>("server_rank");
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  const spec = INTEL_KINDS.find((entry) => entry.kind === kind) ?? INTEL_KINDS[0];

  const snapshotsQuery = useIntelSnapshotsPaged(workspaceId, kind, { limit: 50, offset: 0 });
  const snapshots = useMemo(() => snapshotsQuery.data?.rows ?? [], [snapshotsQuery.data]);

  // 切换类型后原快照不再属于当前列表，必须重选，否则明细查的是别的域的 id
  useEffect(() => {
    setSnapshotId(null);
    setOffset(0);
  }, [kind]);

  useEffect(() => {
    if (snapshotId === null && snapshots.length > 0) setSnapshotId(snapshots[0].id);
    if (snapshotId !== null && snapshots.length > 0 && !snapshots.some((row) => row.id === snapshotId)) {
      setSnapshotId(snapshots[0].id);
      setOffset(0);
    }
  }, [snapshots, snapshotId]);

  const entriesQuery = useIntelEntries(workspaceId, snapshotId, { limit: PAGE_SIZE, offset });
  const activeSnapshot = snapshots.find((row) => row.id === snapshotId) ?? null;
  const entries = entriesQuery.data?.rows ?? [];
  const total = entriesQuery.data?.total ?? 0;

  if (snapshotsQuery.isLoading && snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground">正在读取情报快照…</p>;
  }
  if (snapshotsQuery.error) {
    return <ErrorState message={String(snapshotsQuery.error)} />;
  }
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title={
          allianceCaptureRunning
            ? "同盟情报正在采集中，等本次采集结束后会自动更新。"
            : "当前工作区暂无同盟情报数据。"
        }
        action={
          allianceCaptureRunning
            ? undefined
            : { label: "去采集中心", onClick: () => navigate(ROUTE_PATHS.capture) }
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {INTEL_KINDS.map((entry) => (
          <Button
            key={entry.kind}
            size="sm"
            variant={entry.kind === kind ? "default" : "outline"}
            onClick={() => setKind(entry.kind)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{spec.description}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="快照数量" value={snapshots.length.toLocaleString("zh-CN")} hint="同一主题在不同时间的采集各存一份" />
        <MetricCard
          label="当前快照"
          value={activeSnapshot?.subjectLabel || EMPTY}
          hint={activeSnapshot ? `采集于 ${activeSnapshot.observedAt}` : undefined}
        />
        <MetricCard label="明细条数" value={total.toLocaleString("zh-CN")} />
        <MetricCard
          label="来源接口"
          value={activeSnapshot?.sourceFunc || EMPTY}
          hint="游戏侧 RPC 响应函数名，排查数据缺口时按它对齐采集探针"
          tone="muted"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {snapshots.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => {
              setSnapshotId(row.id);
              setOffset(0);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-left text-xs",
              row.id === snapshotId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            )}
          >
            <span className="font-medium">{row.subjectLabel || row.subjectKey || `#${row.id}`}</span>
            <span className="ml-2 text-muted-foreground">
              {row.entryCount} 条 · {row.observedAt.slice(5, 16).replace("T", " ")}
            </span>
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState title="该快照没有解析出明细条目。" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {spec.columns.map((column) => (
                  <TableHead key={column.key} className={column.numeric ? "text-right" : undefined}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  {spec.columns.map((column) => {
                    const raw = entry[column.key];
                    return (
                      <TableCell
                        key={column.key}
                        className={column.numeric ? "text-right tabular-nums" : undefined}
                      >
                        {column.key === "name" ? (
                          <TruncatedText>{String(raw || EMPTY)}</TruncatedText>
                        ) : typeof raw === "number" ? (
                          formatMetricValue(raw, column.key)
                        ) : (
                          String(raw || EMPTY)
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              第 {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} 条，共 {total} 条
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      {activeSnapshot && (
        <p className="text-xs text-muted-foreground">
          快照 #{activeSnapshot.id} · 类型 <code>{activeSnapshot.kind}</code> · 主题键{" "}
          <code>{activeSnapshot.subjectKey || "(空)"}</code>
          {activeSnapshot.metricsJson && activeSnapshot.metricsJson !== "{}" && (
            <>
              {" · "}
              <Badge variant="secondary" className="align-middle">
                {activeSnapshot.metricsJson}
              </Badge>
            </>
          )}
        </p>
      )}
    </div>
  );
}
