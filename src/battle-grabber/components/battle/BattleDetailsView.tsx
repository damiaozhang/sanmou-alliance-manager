import type { BattleDetails, BattleTeamDetail } from "../../types";
import { formatOptionalNumber, formatBattleLocation, formatCount, formatPercent } from "../../utils/format";
import { MetricCard } from "@/components/MetricCard";
import { BattleResultBanner } from "@/components/BattleResultBanner";
import { BattleTeamCard } from "./BattleTeamCard";

function LossBar(props: { label: string; origin: number; remaining: number; dead: number; wounded: number; tone: string }): JSX.Element {  const lost = Math.max(0, props.origin - props.remaining);
  const rate = props.origin > 0 ? lost / props.origin : 0;
  const remainRate = props.origin > 0 ? props.remaining / props.origin : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={props.tone}>{props.label}</span>
        <span className="text-muted-foreground">{formatCount(props.remaining)} / {formatCount(props.origin)}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-victory" style={{ width: `${Math.round(remainRate * 100)}%` }} />
        <div className="h-full bg-defeat" style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>剩余 {formatPercent(remainRate)}</span>
        <span>损失 {formatPercent(rate)} (亡{formatCount(props.dead)} 伤{formatCount(props.wounded)})</span>
      </div>
    </div>
  );
}

/** 匹配类型 → 中文（与 WinRateTab 分类一致；0/空视为未知）。 */
const MATCH_TYPE_LABELS: Record<number, string> = { 1: "野战", 2: "攻城", 3: "守城", 4: "集结" };
/** 攻城系 combatType / 攻城场景（来自战报协议，可扩展）。 */
const SIEGE_COMBAT_TYPES = new Set([4, 5, 6, 7, 8, 12]);
const SIEGE_SCENARIO_IDS = new Set([1, 2, 3, 11, 12, 21, 22]);

function battleCodeLabel(value: number | null): string {
  if (value === null || value === undefined || value === 0) return "-";
  return String(value);
}

function matchTypeLabel(value: number | null): string {
  if (value === null || value === undefined || value === 0) return "-";
  return MATCH_TYPE_LABELS[value] ?? battleCodeLabel(value);
}

function combatTypeLabel(value: number | null): string {
  if (value === null || value === undefined || value === 0) return "-";
  return SIEGE_COMBAT_TYPES.has(value) ? "攻城系" : battleCodeLabel(value);
}

function scenarioLabel(value: number | null): string {
  if (value === null || value === undefined || value === 0) return "-";
  return SIEGE_SCENARIO_IDS.has(value) ? "攻城场景" : battleCodeLabel(value);
}

export function BattleDetailsView(props: { details: BattleDetails }): JSX.Element {
  const teams: Array<{ key: string; team: BattleTeamDetail; accent: string }> = [];
  if (props.details.attacker) teams.push({ key: "attacker", team: props.details.attacker, accent: "text-side-ally" });
  if (props.details.defender) teams.push({ key: "defender", team: props.details.defender, accent: "text-side-enemy" });

  // 胜方部队：用 armyId 反查参战方玩家名（裸 id 不直出）
  const winnerTeam = teams.find((t) => t.team.armyId === props.details.winnerArmyId);
  const winnerLabel = winnerTeam
    ? winnerTeam.team.player.name || winnerTeam.team.label || props.details.winnerArmyId
    : props.details.winnerArmyId || "-";

  return (
    <div className="space-y-4 rounded-md border border-rank-legendary/20 bg-rank-legendary/[0.03] p-4">
      {/* V7 战果横幅 */}
      <BattleResultBanner details={props.details} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">结构化战报详情</p>
          <p className="mt-1 text-caption text-muted-foreground">{props.details.source || "来自战斗结算数据"}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-caption text-muted-foreground">
          <span className="rounded-md border border-border px-2 py-1">战斗 {props.details.battleId || "-"}</span>
          <span className="rounded-md border border-border px-2 py-1">回合 {formatOptionalNumber(props.details.endRound)}</span>
          <span className="rounded-md border border-border px-2 py-1">坐标 {formatBattleLocation(props.details.location)}</span>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard size="compact" label="胜方部队" value={winnerLabel} tone="primary" />
        <MetricCard size="compact" label="匹配类型" value={matchTypeLabel(props.details.matchType)} />
        <MetricCard size="compact" label="战斗类型" value={combatTypeLabel(props.details.combatType)} />
        <MetricCard size="compact" label="场景" value={scenarioLabel(props.details.scenarioId)} />
      </div>
      {(props.details.attacker || props.details.defender) && (
        <div className="rounded-md border border-border bg-card/80 p-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">战损对比</p>
          <div className="space-y-3">
            {props.details.attacker && (
              <LossBar
                label="攻方"
                origin={props.details.attacker.totals.originTroops}
                remaining={props.details.attacker.totals.remainingTroops}
                dead={props.details.attacker.totals.dead}
                wounded={props.details.attacker.totals.wounded}
                tone="text-side-ally"
              />
            )}
            {props.details.defender && (
              <LossBar
                label="守方"
                origin={props.details.defender.totals.originTroops}
                remaining={props.details.defender.totals.remainingTroops}
                dead={props.details.defender.totals.dead}
                wounded={props.details.defender.totals.wounded}
                tone="text-side-enemy"
              />
            )}
          </div>
        </div>
      )}
      <div className="grid gap-4 2xl:grid-cols-2">
        {teams.map((item) => (
          <BattleTeamCard key={item.key} team={item.team} accent={item.accent} />
        ))}
      </div>
    </div>
  );
}
