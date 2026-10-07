import { useMemo } from "react";
import type { LineupMatchupRow } from "../../tauri";
import { EmptyTableRow } from "@/components/EmptyState";
import { SearchInput } from "@/components/SearchInput";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableCellNumeric, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function MatchupTab({ matchups, query, setQuery }: { matchups: LineupMatchupRow[]; query: string; setQuery: (v: string) => void }) {
  const filtered = useMemo(() => {
    if (!query.trim()) return matchups;
    const q = query.trim().toLowerCase();
    return matchups.filter((m) => {
      const haystack = `${m.attackerPlayerName} ${m.attackerLineupLabel} ${m.defenderPlayerName} ${m.defenderLineupLabel}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [matchups, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, { left: string; right: string; battles: number; leftWins: number; rightWins: number; draws: number }>();
    for (const m of filtered) {
      // 分母口径与 winrate.ts 一致：仅计 win/loss/draw，unknown 不参与
      if (m.outcome !== "win" && m.outcome !== "loss" && m.outcome !== "draw") continue;
      // 对阵归一化：按阵容 key localeCompare 排序（参考 alliance.ts buildAllianceMatchupStats），
      // 避免同一对阵换边产生两行
      const aFirst = m.attackerLineupKey.localeCompare(m.defenderLineupKey, "zh-Hans-CN") <= 0;
      const leftKey = aFirst ? m.attackerLineupKey : m.defenderLineupKey;
      const rightKey = aFirst ? m.defenderLineupKey : m.attackerLineupKey;
      const key = `${leftKey}__${rightKey}`;
      const leftLabel = aFirst ? m.attackerLineupLabel || m.attackerPlayerName : m.defenderLineupLabel || m.defenderPlayerName;
      const rightLabel = aFirst ? m.defenderLineupLabel || m.defenderPlayerName : m.attackerLineupLabel || m.attackerPlayerName;
      // outcome 为攻方视角：win = 攻方胜；归一化后折算到 left/right
      const isDraw = m.outcome === "draw";
      const leftWon = !isDraw && (aFirst ? m.outcome === "win" : m.outcome === "loss");
      const existing = map.get(key);
      if (existing) {
        existing.battles += 1;
        if (isDraw) existing.draws += 1;
        else if (leftWon) existing.leftWins += 1;
        else existing.rightWins += 1;
      } else {
        map.set(key, {
          left: leftLabel,
          right: rightLabel,
          battles: 1,
          leftWins: !isDraw && leftWon ? 1 : 0,
          rightWins: !isDraw && !leftWon ? 1 : 0,
          draws: isDraw ? 1 : 0,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.battles - a.battles);
  }, [filtered]);

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <SearchInput value={query} placeholder="搜索玩家或阵容" onChange={setQuery} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>阵容 A</TableHead>
                <TableHead>阵容 B</TableHead>
                <TableHead>场次</TableHead>
                <TableHead>A 胜 / B 胜 / 平</TableHead>
                <TableHead>A 胜率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.length === 0 ? (
                <EmptyTableRow colSpan={5} title="暂无对阵数据。请先进行同盟战报采集。" />
              ) : (
                grouped.map((g, i) => {
                  // 分母 = 已知场次（win+loss+draw），平局计半胜，与 winrate.ts 一致
                  const total = g.leftWins + g.rightWins + g.draws;
                  const rate = total > 0 ? ((g.leftWins + g.draws * 0.5) / total * 100).toFixed(1) : "-";
                  return (
                    <TableRow key={`${i}-${g.left}-${g.right}`}>
                      <TableCell>{g.left}</TableCell>
                      <TableCell>{g.right}</TableCell>
                      <TableCellNumeric>{g.battles}</TableCellNumeric>
                      <TableCell>
                        <span className="text-victory">胜{g.leftWins}</span>
                        {" / "}
                        <span className="text-defeat">负{g.rightWins}</span>
                        {" / "}
                        <span>平{g.draws}</span>
                      </TableCell>
                      <TableCellNumeric className="tabular-nums">{rate === "-" ? "-" : `${rate}%`}</TableCellNumeric>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
