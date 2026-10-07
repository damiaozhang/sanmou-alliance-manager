import type { BattleHeroDetail } from "../../types";
import { formatOptionalNumber, formatSkillLabel, formatWarbookLabel, formatAssetLabel } from "../../utils/format";
import { DetailRow } from "../ui/DetailRow";

export function BattleHeroCard(props: { hero: BattleHeroDetail }): JSX.Element {
  const totalTroops = props.hero.originTroops ?? props.hero.armyTroops ?? 0;
  const remainingTroops = props.hero.remainingTroops ?? 0;
  const troopPercent = totalTroops > 0 ? Math.max(0, Math.min(100, Math.round((remainingTroops / totalTroops) * 100))) : 0;
  const armsLabel = props.hero.basicArmsName
    ? `${props.hero.basicArmsName}${props.hero.basicArmsId !== null ? ` (#${props.hero.basicArmsId})` : ""}`
    : props.hero.basicArmsId !== null ? `兵种 #${props.hero.basicArmsId}` : "";
  const meta = [
    props.hero.position !== null ? `位次 ${props.hero.position}` : "",
    armsLabel,
    props.hero.level !== null ? `Lv.${props.hero.level}` : "",
    props.hero.evolution !== null ? `红度 ${props.hero.evolution}` : "",
    props.hero.enlighten !== null ? `品 ${props.hero.enlighten}` : "",
  ].filter(Boolean);
  const skillItems = props.hero.skills.map(formatSkillLabel);
  const warbookItems = [
    ...props.hero.warbooks.map(formatWarbookLabel),
    props.hero.warbookItemId && props.hero.warbookItemId !== "0" ? `韬略道具 #${props.hero.warbookItemId}` : "",
  ].filter(Boolean);
  const equipmentItems = [formatAssetLabel("装备", props.hero.equipment.equipId, props.hero.equipment.name, props.hero.equipment.attrs)].filter(Boolean);
  const horseItems = [formatAssetLabel("马匹", props.hero.horse.horseId, props.hero.horse.name, props.hero.horse.attrs)].filter(Boolean);

  return (
    <article className="rounded-md border border-border bg-card/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{props.hero.displayName}</p>
          <p className="mt-1 text-caption text-muted-foreground">
            {props.hero.heroId ? `ID ${props.hero.heroId}` : "武将 ID 未知"}
            {meta.length ? ` / ${meta.join(" / ")}` : ""}
          </p>
        </div>
        <div className="text-right text-caption text-muted-foreground">
          <p>{formatOptionalNumber(props.hero.remainingTroops)} / {formatOptionalNumber(props.hero.originTroops ?? props.hero.armyTroops)}</p>
          <p className="mt-1 text-muted-foreground">阵亡 {formatOptionalNumber(props.hero.dead)} / 伤兵 {formatOptionalNumber(props.hero.wounded)}</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-victory" style={{ width: `${troopPercent}%` }} />
      </div>
      <div className="mt-3 space-y-2">
        <DetailRow label="战法" items={skillItems} />
        <DetailRow label="韬略" items={warbookItems} />
        <DetailRow label="装备" items={equipmentItems} />
        <DetailRow label="马匹" items={horseItems} />
      </div>
    </article>
  );
}
