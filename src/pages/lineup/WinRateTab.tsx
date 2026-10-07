import React, { useMemo, useState } from "react";
import { Target } from "lucide-react";
import type { LineupAnalysisBundle, LineupMatchupRow } from "../../tauri";
import { buildWinRateMatrix, buildCounterRecommendationsV2, MIN_COUNTER_SAMPLE } from "../../lib/winrate";
import { classifyBattle, CATEGORY_OPTIONS, type BattleCategory } from "../../lib/battleClassify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableCellNumeric, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";

function winRateClass(winRate: number): string {
  if (winRate >= 0.6) return "text-defeat font-medium";
  if (winRate <= 0.4) return "text-victory";
  return "text-muted-foreground";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 按 matchType 过滤对阵（S3 分类筛选）。matchType=0 时退化为按原始字段实时分类。 */
function matchCategory(row: LineupMatchupRow): BattleCategory | null {
  if (row.matchType > 0) {
    const map: Record<number, BattleCategory> = { 1: "野战", 2: "攻城", 3: "守城", 4: "集结" };
    return map[row.matchType] ?? null;
  }
  // 旧库未回填 matchType 时，用原始字段实时分类
  return classifyBattle({
    combatType: row.combatType,
    scenarioId: row.scenarioId,
    endRound: row.endRound,
    location: row.location,
  }).category;
}

export const WinRateTab = React.memo(function WinRateTab({
  lineupAnalysis,
}: {
  lineupAnalysis: LineupAnalysisBundle;
}) {
  const [category, setCategory] = useState<BattleCategory | "all">("all");
  const matchups = useMemo(() => {
    if (category === "all") return lineupAnalysis.matchups;
    return lineupAnalysis.matchups.filter((row) => matchCategory(row) === category);
  }, [lineupAnalysis.matchups, category]);

  const matrix = useMemo(() => buildWinRateMatrix(matchups), [matchups]);
  // S1：克制推荐改用 V2 引擎（Wilson 置信区间 + 时间衰减，样本不足自动降权）
  const recommendations = useMemo(() => buildCounterRecommendationsV2(matchups), [matchups]);

  // 空态保留在 tab 内（不再整页早退），其余 tab 不受影响
  if (matrix.attackerKeys.length === 0 || matrix.defenderKeys.length === 0) {
    return (
      <EmptyState title="暂无阵容对阵数据。请先通过战报采集获取同盟战报，系统会按每场战报生成阵容对阵记录。" />
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Target size={18} />
            阵容胜率矩阵
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">作战类型</span>
            <Select value={category} onValueChange={(v) => setCategory(v as BattleCategory | "all")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            行是攻击方阵容，列是防守方阵容；每格显示 胜-负-平 与攻击方胜率。胜率 ≥60% 标红、≤40% 标绿。
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">攻击方 \ 防守方</TableHead>
                  {matrix.defenderKeys.map((dKey) => (
                    <TableHead key={dKey} className="whitespace-nowrap">{matrix.labels[dKey]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrix.attackerKeys.map((aKey) => (
                  <TableRow key={aKey}>
                    <TableCell className="whitespace-nowrap font-medium">{matrix.labels[aKey]}</TableCell>
                    {matrix.defenderKeys.map((dKey) => {
                      const cell = matrix.cells[aKey]?.[dKey];
                      if (!cell || cell.battles === 0) {
                        return <TableCell key={dKey} className="text-muted-foreground">-</TableCell>;
                      }
                      return (
                        <TableCellNumeric key={dKey} className="whitespace-nowrap">
                          <span>{cell.wins}-{cell.losses}-{cell.draws}</span>{" "}
                          <span className={winRateClass(cell.winRate)}>{formatPercent(cell.winRate)}</span>
                        </TableCellNumeric>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target size={18} />
            克制推荐
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            针对每个防守方阵容，按「Wilson 置信下界 + 红度差」得分推荐攻击方阵容 Top 3
            （防守方总场次 ≥ {MIN_COUNTER_SAMPLE} 才参与推荐；小样本胜率会自动降权，近 30 天战报权重更高）。
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>防守方阵容</TableHead>
                <TableHead>场次</TableHead>
                <TableHead>推荐攻击方阵容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recommendations.map((rec) => (
                <TableRow key={rec.defenderKey}>
                  <TableCell className="whitespace-nowrap font-medium">{rec.defenderLabel}</TableCell>
                  <TableCellNumeric>{rec.totalBattles}</TableCellNumeric>
                  <TableCell>
                    {!rec.sufficient ? (
                      <Badge variant="secondary">样本不足</Badge>
                    ) : (
                      <div className="space-y-1.5">
                        {rec.picks.map((pick, i) => (
                          <div key={pick.attackerKey} className="text-sm">
                            <span className="text-muted-foreground">{i + 1}.</span>{" "}
                            <span className="font-medium">{pick.attackerLabel}</span>{" "}
                            <span className={winRateClass(pick.winRate)}>{formatPercent(pick.winRate)}</span>{" "}
                            <span className="text-muted-foreground">
                              {pick.wins}-{pick.losses}-{pick.draws}
                            </span>
                            <div className="text-caption text-muted-foreground">{pick.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
});
