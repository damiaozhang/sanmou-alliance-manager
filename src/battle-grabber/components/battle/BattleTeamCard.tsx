import type { BattleTeamDetail } from "../../types";
import { formatCount, formatOptionalNumber, normaliseFormationName } from "../../utils/format";
import { MetricCard } from "@/components/MetricCard";
import { BattleHeroCard } from "./BattleHeroCard";

export function BattleTeamCard(props: { team: BattleTeamDetail; accent: string }): JSX.Element {
  const playerName = props.team.player.name || (props.team.player.avatarId ? `玩家 #${props.team.player.avatarId}` : "未知玩家");
  const formationName = normaliseFormationName(props.team.formationName);
  const formationLabel = formationName || (props.team.formationId ? `#${props.team.formationId}` : "-");
  const heroes = [...props.team.heroes].sort((l, r) => (l.position ?? 99) - (r.position ?? 99));

  return (
    <section className="rounded-md border border-border bg-card/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${props.accent}`}>{props.team.label || props.team.side}</p>
            {props.team.winner && (
              <span className="rounded-md border border-rank-legendary/40 bg-rank-legendary/10 px-2 py-0.5 text-xs text-primary">胜</span>
            )}
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {playerName}{props.team.player.allianceName ? ` / ${props.team.player.allianceName}` : ""}
          </p>
        </div>
        <div className="text-right text-caption text-muted-foreground">
          <p>部队 {props.team.armyId || "-"}</p>
          <p className="mt-1">阵型 {formationLabel}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
        <MetricCard size="compact" label="剩余兵力" value={formatCount(props.team.totals.remainingTroops)} tone="victory" />
        <MetricCard size="compact" label="初始兵力" value={formatCount(props.team.totals.originTroops)} />
        <MetricCard size="compact" label="士气" value={formatOptionalNumber(props.team.morale)} tone="info" />
        <MetricCard size="compact" label="统御" value={formatOptionalNumber(props.team.zgNum)} />
        <MetricCard size="compact" label="阵亡" value={formatCount(props.team.totals.dead)} tone="defeat" />
        <MetricCard size="compact" label="伤兵" value={formatCount(props.team.totals.wounded)} tone="primary" />
      </div>
      <div className="mt-3 space-y-3">
        {heroes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">这方阵容没有可展示的武将明细。</p>
        ) : (
          heroes.map((h) => <BattleHeroCard key={`${props.team.armyId}:${h.heroId}:${h.position}`} hero={h} />)
        )}
      </div>
    </section>
  );
}
