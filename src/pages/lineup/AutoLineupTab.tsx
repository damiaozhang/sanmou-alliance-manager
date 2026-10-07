import { useMemo } from "react";
import type { LineupStatRow } from "../../tauri";
import { MetricCard } from "@/components/MetricCard";
import { EmptyTableRow } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableCellNumeric, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatWinRate(wins: number, losses: number, draws: number): string {
  const total = wins + losses + draws;
  if (total === 0) return "-";
  const rate = ((wins + draws * 0.5) / total * 100).toFixed(1);
  return `${rate}%`;
}

function formatLossRatio(ratio: number): string {
  if (ratio <= 0) return "-";
  return `${ratio.toFixed(2)}x`;
}

export function AutoLineupTab({ stats, query, setQuery, onPlayerClick }: { stats: LineupStatRow[]; query: string; setQuery: (v: string) => void; onPlayerClick?: (avatarId: string) => void }) {
  const filtered = useMemo(() => {
    if (!query.trim()) return stats;
    const q = query.trim().toLowerCase();
    return stats.filter((s) => {
      const haystack = `${s.label} ${s.playerName} ${s.allianceName} ${s.formationName}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [stats, query]);

  const uniquePlayers = new Set(stats.map((s) => s.avatarId)).size;
  const totalBattles = stats.reduce((sum, s) => sum + s.battles, 0);
  const totalWins = stats.reduce((sum, s) => sum + s.wins, 0);

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="阵容数" value={stats.length} />
            <MetricCard label="玩家数" value={uniquePlayers} />
            <MetricCard label="总场次" value={totalBattles} />
            <MetricCard label="总胜场" value={totalWins} />
          </div>
          <SearchInput
            value={query}
            placeholder="搜索阵容、玩家、同盟、阵型"
            onChange={setQuery}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>玩家</TableHead>
                <TableHead>阵容</TableHead>
                <TableHead>阵型</TableHead>
                <TableHead>场次</TableHead>
                <TableHead>胜/负/平</TableHead>
                <TableHead>胜率</TableHead>
                <TableHead>武勋</TableHead>
                <TableHead>平均红度</TableHead>
                <TableHead>损耗比</TableHead>
                <TableHead>最后出场</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <EmptyTableRow colSpan={10} title="暂无自动采集的阵容统计。请先进行同盟战报采集。" />
              ) : (
                filtered.map((s, idx) => (
                  <TableRow key={`${s.avatarId}-${s.lineupKey}-${idx}`}>
                    <TableCell>
                      {s.avatarId && onPlayerClick ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPlayerClick(s.avatarId)}
                        >
                          <strong>{s.playerName || "-"}</strong>
                        </Button>
                      ) : (
                        <strong>{s.playerName || "-"}</strong>
                      )}
                      {s.allianceName && <span className="text-sm text-muted-foreground ml-1">{s.allianceName}</span>}
                    </TableCell>
                    <TableCell>{s.label}</TableCell>
                    <TableCell>{s.formationName || "-"}</TableCell>
                    <TableCellNumeric>{s.battles}</TableCellNumeric>
                    <TableCell>
                      <span className="text-victory">胜{s.wins}</span>
                      {" / "}
                      <span className="text-defeat">负{s.losses}</span>
                      {" / "}
                      <span>平{s.draws}</span>
                    </TableCell>
                    <TableCellNumeric>{formatWinRate(s.wins, s.losses, s.draws)}</TableCellNumeric>
                    <TableCellNumeric>{s.totalMerit > 0 ? s.totalMerit.toLocaleString('zh-CN') : "-"}</TableCellNumeric>
                    <TableCellNumeric>{s.avgEvolution > 0 ? `${s.avgEvolution.toFixed(1)}红` : "-"}</TableCellNumeric>
                    <TableCellNumeric>{formatLossRatio(s.lossExchangeRatio)}</TableCellNumeric>
                    <TableCell>{s.lastBattleTime ? new Date(s.lastBattleTime).toLocaleDateString('zh-CN') : "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
