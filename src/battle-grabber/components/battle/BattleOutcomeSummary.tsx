import type { BattleDetails } from "../../types";
import { formatOptionalNumber, formatBattleLineup, formatBattleTeamOwner, formatBattleLoss } from "../../utils/format";

export function BattleOutcomeSummary(props: { details: BattleDetails }): JSX.Element {
  const attackerWon = Boolean(props.details.attacker?.winner);
  const defenderWon = Boolean(props.details.defender?.winner);
  const result = attackerWon ? "攻方胜" : defenderWon ? "守方胜" : "平局 / 未知";

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="text-caption text-muted-foreground">结果</p>
          <p className="mt-2 text-lg font-semibold text-primary">{result}</p>
          <p className="mt-1 text-caption text-muted-foreground">回合 {formatOptionalNumber(props.details.endRound)}</p>
        </div>
        <div className="rounded-md border border-side-ally/20 bg-side-ally/5 p-3">
          <p className="text-xs text-side-ally">攻方 · {formatBattleTeamOwner(props.details.attacker)}</p>
          <p className="mt-2 text-sm text-foreground">{formatBattleLineup(props.details.attacker)}</p>
          <p className="mt-2 text-caption text-muted-foreground">战损 {formatBattleLoss(props.details.attacker)}</p>
        </div>
        <div className="rounded-md border border-side-enemy/20 bg-side-enemy/5 p-3">
          <p className="text-xs text-side-enemy">守方 · {formatBattleTeamOwner(props.details.defender)}</p>
          <p className="mt-2 text-sm text-foreground">{formatBattleLineup(props.details.defender)}</p>
          <p className="mt-2 text-caption text-muted-foreground">战损 {formatBattleLoss(props.details.defender)}</p>
        </div>
      </div>
    </div>
  );
}
