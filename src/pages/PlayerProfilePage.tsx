import React, { useCallback, useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, User, Swords, ShieldEllipsis, Link2, RefreshCw, Crosshair } from "lucide-react";
import type { AppBundle, MemberSnapshotRow } from "../tauri";
import { formatCaptureRecordTime, formatUnixSeconds } from "@/lib/dates";
import { formatErrorMessage } from "@/lib/format";
import { useAppData, useAllMemberSnapshots } from "@/app/queries";
import { useActiveWorkspaceContext } from "@/features/workspace/useActiveWorkspaceContext";
import { ROUTE_PATHS } from "@/app/routes";
import { resultBadgeVariant, type BattleResultLabel } from "@/lib/labels";
import { buildCounterRecommendationsV2, MIN_COUNTER_SAMPLE } from "@/lib/winrate";
import { pickMainLineups, lineupWinRate, buildLineupChangeTimeline } from "@/lib/playerProfile";
import { MetricCard } from "@/components/MetricCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SuspenseFallback } from "@/components/SuspenseFallback";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY_MEMBER_SNAPSHOTS: MemberSnapshotRow[] = [];
const EMPTY_MEMBER_BINDINGS: NonNullable<AppBundle["memberBindings"]> = [];

export const PlayerProfilePage = React.memo(function PlayerProfilePage({
  avatarId,
  onBack
}: {
  avatarId: string;
  onBack: () => void;
}) {
  // 阶段4：页面自取数据，不再接收 App 下钻的 bundle props
  const { workspaceId } = useActiveWorkspaceContext();
  const { bundle, lineupAnalysis, isLoading: appLoading, firstError: appError } = useAppData(workspaceId);
  // 阶段3b：成员快照历史改走 get_member_snapshots；P1-3 修复为全量循环分页，
  // 避免单玩家历史超过 2000 条时被截断。
  const memberHistoryQuery = useAllMemberSnapshots(workspaceId);
  const memberSnapshots = memberHistoryQuery.data ?? EMPTY_MEMBER_SNAPSHOTS;
  const memberBindings = bundle?.memberBindings ?? EMPTY_MEMBER_BINDINGS;

  const playerSnapshots = useMemo(
    () => memberSnapshots
      .filter((s) => s.avatarId === avatarId)
      .sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? "")),
    [memberSnapshots, avatarId]
  );
  const latestSnapshot = playerSnapshots[0] ?? null;

  const playerStats = useMemo(
    () => lineupAnalysis.stats.filter((s) => s.avatarId === avatarId),
    [lineupAnalysis.stats, avatarId]
  );

  const playerMatchups = useMemo(
    () =>
      lineupAnalysis.matchups.filter(
        (m) => m.attackerAvatarId === avatarId || m.defenderAvatarId === avatarId
      ),
    [lineupAnalysis.matchups, avatarId]
  );

  const playerBindings = useMemo(
    () => memberBindings.filter((b) => b.avatar === avatarId),
    [memberBindings, avatarId]
  );

  const totalBattles = playerStats.reduce((sum, s) => sum + s.battles, 0);
  const totalWins = playerStats.reduce((sum, s) => sum + s.wins, 0);
  const totalMerit = playerStats.reduce((sum, s) => sum + s.totalMerit, 0);

  // S2 敌方画像：
  const { main: mainLineup, alternates } = useMemo(
    () => pickMainLineups(playerStats),
    [playerStats]
  );
  const mainWinRate = lineupWinRate(mainLineup);
  // 仅取该玩家自身的对阵（已在 playerMatchups 过滤为 attacker/defender === avatarId），
  // 避免把其他玩家的战斗混入换阵时间线；函数内部按时间降序，slice 取最近 20 次。
  const lineupChanges = useMemo(
    () => buildLineupChangeTimeline(playerMatchups, avatarId),
    [playerMatchups, avatarId]
  );
  // 克制建议：以该玩家为防守方，推荐攻击方阵容（含玩家自己打自己的过滤——玩家只出现在一方）
  const counterRecs = useMemo(() => {
    const asDefender = lineupAnalysis.matchups.filter((m) => m.defenderAvatarId === avatarId);
    if (asDefender.length === 0) return [];
    return buildCounterRecommendationsV2(asDefender);
  }, [lineupAnalysis.matchups, avatarId]);

  if (appError) {
    return (
      <PageShell>
        <Card>
          <CardContent className="pt-6">
            <ErrorState message={`玩家档案加载失败：${formatErrorMessage(appError)}`} />
          </CardContent>
        </Card>
      </PageShell>
    );
  }
  if (appLoading && !bundle) {
    return (
      <PageShell>
        <SuspenseFallback variant="page" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} title="返回">
              <ArrowLeft size={18} />
            </Button>
            <User size={18} />
            玩家档案
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User size={18} />
            基本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberHistoryQuery.isLoading && memberSnapshots.length === 0 ? (
            <SuspenseFallback variant="card" />
          ) : latestSnapshot ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <MetricCard label="名称" value={latestSnapshot.avatarName} />
                <MetricCard label="ID" value={latestSnapshot.avatarId} />
                <MetricCard label="同盟" value={latestSnapshot.legionName ?? "-"} />
                <MetricCard label="职业" value={latestSnapshot.professionName ?? "-"} />
                <MetricCard label="在线" value={latestSnapshot.isOnline === 1 ? "在线" : "离线"} />
                <MetricCard label="坐标" value={`${latestSnapshot.coordinateX},${latestSnapshot.coordinateY}`} />
              </div>
              <Separator />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <MetricCard label="繁荣" value={latestSnapshot.prosperity ?? 0} />
                <MetricCard label="周贡献" value={latestSnapshot.weeklyContribution} />
                <MetricCard label="周武勋" value={latestSnapshot.weeklyMerit} />
                <MetricCard label="赛季积分" value={latestSnapshot.seasonScore ?? 0} />
                <MetricCard label="攻城值" value={latestSnapshot.demolitionValue} />
                <MetricCard label="入盟时间" value={formatUnixSeconds(latestSnapshot.joinTs)} />
              </div>
            </div>
          ) : (
            <EmptyState title="未找到该玩家的成员快照数据。" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldEllipsis size={18} />
            阵容使用
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="阵容数" value={playerStats.length} />
            <MetricCard label="总场次" value={totalBattles} />
            <MetricCard label="总胜场" value={totalWins} />
            <MetricCard label="总武勋" value={totalMerit.toLocaleString('zh-CN')} />
          </div>
          {mainLineup && (
            <div className="rounded-md border border-primary/20 bg-brand-soft px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">主队</Badge>
                <span className="font-medium">{mainLineup.label}</span>
                <span className="text-muted-foreground">
                  {mainLineup.battles} 场 · 胜率{" "}
                  <span className={mainWinRate >= 0.5 ? "text-victory font-medium" : "text-defeat"}>
                    {(mainWinRate * 100).toFixed(1)}%
                  </span>
                </span>
                {mainLineup.lastBattleTime && (
                  <span className="text-caption text-muted-foreground">
                    最近出场 {new Date(mainLineup.lastBattleTime).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </div>
              {alternates.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-caption text-muted-foreground">常驻副队：</span>
                  {alternates.map((alt) => (
                    <Badge key={alt.lineupKey} variant="outline">
                      {alt.label}（{alt.battles} 场）
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
          {playerStats.length === 0 ? (
            <EmptyState title="暂无该玩家的阵容统计数据。" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>阵容</TableHead>
                  <TableHead>阵型</TableHead>
                  <TableHead>场次</TableHead>
                  <TableHead>胜/负/平</TableHead>
                  <TableHead>胜率</TableHead>
                  <TableHead>武勋</TableHead>
                  <TableHead>损耗比</TableHead>
                  <TableHead>最后出场</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {playerStats.map((s, idx) => {
                  const total = s.wins + s.losses + s.draws;
                  const rate =
                    total > 0
                      ? (((s.wins + s.draws * 0.5) / total) * 100).toFixed(1)
                      : "-";
                  return (
                    <TableRow key={`${s.lineupKey}-${idx}`}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          {mainLineup?.lineupKey === s.lineupKey && (
                            <Badge variant="default" className="px-1.5 py-0 text-[11px]">主</Badge>
                          )}
                          {s.label}
                        </span>
                      </TableCell>
                      <TableCell>{s.formationName || "-"}</TableCell>
                      <TableCell>{s.battles}</TableCell>
                      <TableCell>
                        <span className="text-victory">{s.wins}</span>
                        {" / "}
                        <span className="text-defeat">{s.losses}</span>
                        {" / "}
                        <span>{s.draws}</span>
                      </TableCell>
                      <TableCell>{rate === "-" ? "-" : `${rate}%`}</TableCell>
                      <TableCell>{s.totalMerit > 0 ? s.totalMerit.toLocaleString('zh-CN') : "-"}</TableCell>
                      <TableCell>
                        {s.lossExchangeRatio > 0
                          ? `${s.lossExchangeRatio.toFixed(2)}x`
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {s.lastBattleTime
                          ? new Date(s.lastBattleTime).toLocaleDateString('zh-CN')
                          : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw size={18} />
            换阵时间线
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lineupChanges.length === 0 ? (
            <EmptyState title="暂无换阵记录：该玩家的出场阵容始终保持一致，或战报样本不足。" />
          ) : (
            <div className="space-y-2">
              {lineupChanges.slice(-20).map((change, idx) => (
                <div key={`${change.time}-${idx}`} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-caption text-muted-foreground tabular-nums">
                    {new Date(change.time).toLocaleString('zh-CN')}
                  </span>
                  <Badge variant="outline">{change.from}</Badge>
                  <ArrowLeft size={14} className="shrink-0 text-muted-foreground" />
                  <Badge variant="default">{change.to}</Badge>
                </div>
              ))}
              {lineupChanges.length > 20 && (
                <p className="text-caption text-muted-foreground">
                  共 {lineupChanges.length} 次换阵，仅显示最近 20 次。
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crosshair size={18} />
            对战克制建议
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {counterRecs.length === 0 ? (
            <EmptyState
              title={`暂无针对 ${latestSnapshot?.avatarName ?? "该玩家"} 的克制建议。${
                playerMatchups.some((m) => m.defenderAvatarId === avatarId)
                  ? "该玩家防守场次样本不足（< " + MIN_COUNTER_SAMPLE + " 场）。"
                  : "该玩家没有以防守方出战的记录，克制建议基于其防守对阵计算。"
              }`}
            />
          ) : (
            counterRecs.map((rec) => (
              <div key={rec.defenderKey} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">防守方 {rec.defenderLabel}</span>
                  <Badge variant="secondary">{rec.totalBattles} 场</Badge>
                  {!rec.sufficient && <Badge variant="outline">样本不足</Badge>}
                </div>
                {rec.picks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无可用攻击方样本。</p>
                ) : (
                  <ul className="space-y-1.5">
                    {rec.picks.map((pick, i) => (
                      <li key={pick.attackerKey} className="text-sm">
                        <span className="text-muted-foreground">{i + 1}.</span>{" "}
                        <span className="font-medium">{pick.attackerLabel}</span>{" "}
                        <span className={pick.winRate >= 0.5 ? "text-victory font-medium" : "text-defeat"}>
                          {(pick.winRate * 100).toFixed(0)}%
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {pick.wins}-{pick.losses}-{pick.draws}
                        </span>
                        <div className="text-caption text-muted-foreground">{pick.reason}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Swords size={18} />
            战斗记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          {playerMatchups.length === 0 ? (
            <EmptyState title="暂无该玩家的战斗记录。" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>身份</TableHead>
                  <TableHead>对手</TableHead>
                  <TableHead>己方阵容</TableHead>
                  <TableHead>对方阵容</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>战报码</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {playerMatchups.slice(0, 50).map((m, idx) => {
                  const isAttacker = m.attackerAvatarId === avatarId;
                  const isWin = (isAttacker && m.outcome === "win") || (!isAttacker && m.outcome === "loss");
                  const isLoss = (isAttacker && m.outcome === "loss") || (!isAttacker && m.outcome === "win");
                  const resultLabel: BattleResultLabel = isWin ? "胜" : isLoss ? "负" : "平";
                  return (
                    <TableRow key={`${m.battleCode}-${m.battleTime}-${idx}`}>
                      <TableCell>
                        {m.battleTime
                          ? new Date(m.battleTime).toLocaleString('zh-CN')
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isAttacker ? "default" : "secondary"}>
                          {isAttacker ? "进攻" : "防守"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isAttacker ? m.defenderPlayerName : m.attackerPlayerName}
                      </TableCell>
                      <TableCell>
                        {isAttacker
                          ? m.attackerLineupLabel || "-"
                          : m.defenderLineupLabel || "-"}
                      </TableCell>
                      <TableCell>
                        {isAttacker
                          ? m.defenderLineupLabel || "-"
                          : m.attackerLineupLabel || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={resultBadgeVariant(resultLabel)}>{resultLabel}</Badge>
                      </TableCell>
                      <TableCell>{m.battleCode || "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 size={18} />
            绑定历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          {playerBindings.length === 0 ? (
            <EmptyState title="暂无该玩家的绑定记录。" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playerBindings.map((b) => (
                <Card key={`${b.avatar}-${b.updated}-${b.playerId}`}>
                  <CardContent className="pt-6 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={b.status === "已绑定" ? "success" : b.status === "待确认" ? "secondary" : "outline"}>
                        {b.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{formatCaptureRecordTime(b.updated)}</span>
                    </div>
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-sm">ID: {b.avatar}</p>
                    <p className="text-caption text-muted-foreground">
                      同盟: {b.alliance}
                      {b.playerId ? ` / player #${b.playerId}` : ""}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
});

// 玩家档案路由 wrapper（阶段4 自 App.tsx 下沉）：从 URL 参数取 avatarId，
// 返回键优先走站内历史，直接以无历史状态进入时回退到同盟数据页
export function PlayerProfileRoute() {
  const { avatarId } = useParams();
  const navigate = useNavigate();
  const handleBack = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
    } else {
      navigate(ROUTE_PATHS.alliance, { replace: true });
    }
  }, [navigate]);
  if (!avatarId) return <Navigate to={ROUTE_PATHS.alliance} replace />;
  return <PlayerProfilePage avatarId={avatarId} onBack={handleBack} />;
}
