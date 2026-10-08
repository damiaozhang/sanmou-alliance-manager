import React, { useMemo, useState } from "react";
import type { LineupStatRow, MemberSnapshotRow } from "../tauri";
import type { SortState } from "@/lib/sort";
import { useAppData, useMemberSnapshotsPaged } from "@/app/queries";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/EmptyState";
import { PageHead } from "@/components/PageHead";
import { SortIndicator } from "@/components/SortIndicator";
import { cn } from "@/lib/utils";
import { buildLegionNameIndex, resolveLegionLabel } from "@/features/alliance/members";

type PlayerAgg = {
  avatarId: string;
  playerName: string;
  allianceName: string;
  legion: string;
  lineupCount: number;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  totalMerit: number;
  totalDamage: number;
};

export function aggregateByPlayer(
  stats: LineupStatRow[],
  members: { avatarId: string; avatarName: string; legionName?: string | null; legionId?: number | null }[]
): PlayerAgg[] {
  // P1-4 修复：legion_name 常为空，用 legion_id 推导出的名称兜底，避免军团列全空。
  const legionIndex = buildLegionNameIndex(
    members.map((m) => ({ legion: m.legionName, legionId: m.legionId }))
  );
  const memberMap = new Map<string, { name: string; legion: string }>();
  for (const m of members) {
    if (m.avatarId) {
      memberMap.set(m.avatarId, {
        name: m.avatarName,
        legion: resolveLegionLabel({ legion: m.legionName, legionId: m.legionId }, legionIndex),
      });
    }
  }

  const map = new Map<string, PlayerAgg>();
  for (const s of stats) {
    const key = s.avatarId || s.playerName || `unknown-${s.id}`;
    let agg = map.get(key);
    if (!agg) {
      const member = s.avatarId ? memberMap.get(s.avatarId) : undefined;
      agg = {
        avatarId: s.avatarId,
        playerName: member?.name || s.playerName || "-",
        allianceName: s.allianceName,
        legion: member?.legion || "",
        lineupCount: 0, battles: 0, wins: 0, losses: 0, draws: 0,
        totalMerit: 0, totalDamage: 0,
      };
      map.set(key, agg);
    }
    agg.lineupCount += 1;
    agg.battles += s.battles;
    agg.wins += s.wins;
    agg.losses += s.losses;
    agg.draws += s.draws;
    agg.totalMerit += s.totalMerit;
    agg.totalDamage += s.totalEnemyDead + s.totalEnemyWounded;
    if (!agg.playerName && s.playerName) agg.playerName = s.playerName;
    if (!agg.allianceName && s.allianceName) agg.allianceName = s.allianceName;
  }
  return Array.from(map.values());
}

function formatWinRate(wins: number, losses: number, draws: number): string {
  const total = wins + losses + draws;
  if (total === 0) return "-";
  const rate = ((wins + draws * 0.5) / total * 100).toFixed(1);
  return `${rate}%`;
}

function getWinRateValue(p: PlayerAgg): number {
  const total = p.wins + p.losses + p.draws;
  if (total === 0) return 0;
  return (p.wins + p.draws * 0.5) / total;
}

type RankSortKey = "merit" | "winRate" | "battles" | "damage" | "lineupCount";

const SORT_COLUMNS: Array<{ key: RankSortKey; label: string; align?: "right" }> = [
  { key: "merit", label: "武勋" },
  { key: "winRate", label: "胜率" },
  { key: "battles", label: "场次" },
  { key: "damage", label: "击伤" },
  { key: "lineupCount", label: "阵容数", align: "right" },
];

// 空态用模块级常量，保证引用稳定
const EMPTY_MEMBER_ROWS: MemberSnapshotRow[] = [];

export const AllianceRankingPage = React.memo(function AllianceRankingPage() {
  // 阶段4：页面自取数据，不再接收 App 下钻 props
  const { workspaceId } = useActiveWorkspaceContext();
  const { lineupAnalysis } = useAppData(workspaceId);
  const [sort, setSort] = useState<SortState<RankSortKey>>({ key: "merit", direction: "desc" });

  // 阶段3b：成员快照改走 get_member_snapshots（latestOnly=true 服务端已去重，无需客户端 dedup）
  const memberSnapshotsQuery = useMemberSnapshotsPaged(workspaceId, true, { limit: 500, offset: 0 });
  const members = memberSnapshotsQuery.data?.rows ?? EMPTY_MEMBER_ROWS;

  const playerAgg = useMemo(() => aggregateByPlayer(lineupAnalysis.stats, members), [lineupAnalysis.stats, members]);

  const totalPlayers = playerAgg.length;
  const totalBattles = playerAgg.reduce((s, p) => s + p.battles, 0);
  const totalMerit = playerAgg.reduce((s, p) => s + p.totalMerit, 0);
  const totalWins = playerAgg.reduce((s, p) => s + p.wins, 0);
  const totalLosses = playerAgg.reduce((s, p) => s + p.losses, 0);
  const totalDraws = playerAgg.reduce((s, p) => s + p.draws, 0);
  const avgWinRate = formatWinRate(totalWins, totalLosses, totalDraws);

  const sorted = useMemo(() => {
    const copy = [...playerAgg];
    const byName = (a: PlayerAgg, b: PlayerAgg) => a.playerName.localeCompare(b.playerName);
    const getValue = (p: PlayerAgg, key: RankSortKey): number => {
      switch (key) {
        case "merit": return p.totalMerit;
        case "winRate": return getWinRateValue(p);
        case "battles": return p.battles;
        case "damage": return p.totalDamage;
        case "lineupCount": return p.lineupCount;
      }
    };
    const dir = sort.direction === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const diff = (getValue(a, sort.key) - getValue(b, sort.key)) * dir;
      if (diff !== 0) return diff;
      return byName(a, b);
    });
    return copy;
  }, [playerAgg, sort]);

  const toggle = (key: RankSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" }
    );
  };

  return (
    <div className="p-5">
      <PageHead
        title="同盟战力排行"
        description="按武勋、胜率、场次等指标对成员排序，点击表头切换排序方向。"
      />
      <section className="surface-card mb-4 grid grid-cols-2 divide-x divide-[var(--hair)] overflow-hidden md:grid-cols-4">
        <div className="px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground">总玩家数</p>
          <p className="mt-1 text-metric font-semibold tabular-nums">{totalPlayers}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground">总场次</p>
          <p className="mt-1 text-metric font-semibold tabular-nums">{totalBattles.toLocaleString('zh-CN')}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground">总武勋</p>
          <p className="mt-1 text-metric font-semibold tabular-nums">{totalMerit.toLocaleString('zh-CN')}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground">平均胜率</p>
          <p className="mt-1 text-metric font-semibold tabular-nums">{avgWinRate}</p>
        </div>
      </section>

      <div className="surface-card overflow-hidden">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur">
            <TableRow>
              <TableHead className="w-14">排名</TableHead>
              <TableHead>玩家</TableHead>
              <TableHead>分组</TableHead>
              {SORT_COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <TableHead
                    key={col.key}
                    // P2-7：排序控件改为真正的 <button> 并补 aria-sort，
                    // 让键盘/读屏用户也能排序（此前挂在 <th onClick> 上不可达）。
                    aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("whitespace-nowrap", col.align === "right" && "text-right")}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={cn(
                        "inline-flex cursor-pointer select-none items-center rounded-sm hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        col.align === "right" && "w-full justify-end"
                      )}
                    >
                      {col.label}
                      <SortIndicator active={active} direction={sort.direction} />
                    </button>
                  </TableHead>
                );
              })}
              <TableHead>胜/负/平</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <EmptyTableRow colSpan={10} title="暂无阵容统计数据。请先进行同盟战报采集。" />
            ) : (
              sorted.map((p, i) => (
                <TableRow key={p.avatarId || p.playerName}>
                  <TableCell>
                    {i < 3 ? (
                      <strong className={cn(i === 0 ? "text-rank-legendary" : i === 1 ? "text-rank-elite" : "text-rank-advanced")}>{i + 1}</strong>
                    ) : (
                      i + 1
                    )}
                  </TableCell>
                  <TableCell>
                    <strong>{p.playerName}</strong>
                    {p.allianceName && <span className="text-sm text-muted-foreground ml-1">{p.allianceName}</span>}
                  </TableCell>
                  <TableCell>{p.legion || "-"}</TableCell>
                  <TableCell className="tabular-nums">{p.totalMerit > 0 ? p.totalMerit.toLocaleString('zh-CN') : "-"}</TableCell>
                  <TableCell className="tabular-nums">{formatWinRate(p.wins, p.losses, p.draws)}</TableCell>
                  <TableCell className="tabular-nums">{p.battles}</TableCell>
                  <TableCell className="tabular-nums">{p.totalDamage > 0 ? p.totalDamage.toLocaleString('zh-CN') : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.lineupCount}</TableCell>
                  <TableCell>
                    <span className="text-victory">{p.wins}</span>
                    {" / "}
                    <span className="text-defeat">{p.losses}</span>
                    {" / "}
                    <span>{p.draws}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
});
