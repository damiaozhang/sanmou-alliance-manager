import { useState } from "react";
import type { JsonRecord, AllianceSidePrefix, BattleHeroDetail } from "../../types";
import { asArray, asId, asRecord } from "../../utils/helpers";
import { formatCount, formatAllianceFormationLabel, formatSkillLabel, formatWarbookLabel, formatAssetLabel, formatAllianceHeroHeader, formatAllianceHeroTroopDetail } from "../../utils/format";
import {
  getAllianceSideRecord, getAllianceSideAllianceName, getAllianceSidePlayerName,
  getAllianceSideFormationId, getAllianceSideFormationName, getAllianceSideLineupDisplayLabel,
  getAllianceSideHeroLevels, getAllianceSideMerit, getAllianceSideTroopText, getAllianceSideHeroes,
} from "../../utils/alliance";
import { parseBattleHero } from "../../utils/battle";

function getAllianceSideSnapshotExtras(side: JsonRecord): string[] {
  const outsideBuffs = asArray(side["outsideBuffList"]).map(asId).filter(Boolean);
  const outOfBattleEffects = asArray(side["outOfBattleEffectsList"]).map(asId).filter(Boolean);
  const season = asRecord(side["seasonOSData"]);
  const seasonBoatType = season ? asId(season["battleBoatType"]) : "";
  const seasonBoatList = season ? asArray(season["battleBoatList"]) : [];
  const armyComp = asRecord(side["armyCompInfo"]);
  const compBoatList = armyComp ? asArray(armyComp["battleBoatList"]) : [];
  const trigramCount = armyComp ? Object.keys(asRecord(armyComp["trigramList"]) ?? {}).length : 0;
  return [
    outsideBuffs.length > 0 ? `外部Buff ${outsideBuffs.slice(0, 8).join("/")}` : "",
    outOfBattleEffects.length > 0 ? `战外效果 ${outOfBattleEffects.slice(0, 8).join("/")}` : "",
    seasonBoatType || seasonBoatList.length > 0
      ? `赛季组件 ${[seasonBoatType ? `舟船${seasonBoatType}` : "", seasonBoatList.length ? `${seasonBoatList.length}件` : ""].filter(Boolean).join(" / ")}`
      : "",
    compBoatList.length > 0 ? `军队组件 ${compBoatList.length}件` : "",
    trigramCount > 0 ? `八卦 ${trigramCount}项` : "",
  ].filter(Boolean);
}

function hasAllianceSideSnapshotDetails(record: JsonRecord, prefix: AllianceSidePrefix): boolean {
  const side = getAllianceSideRecord(record, prefix);
  if (!side) return false;
  return getAllianceSideHeroes(record, prefix).length > 0 || getAllianceSideSnapshotExtras(side).length > 0;
}

function AllianceLineupSnapshotDetails(props: { record: JsonRecord; prefix: AllianceSidePrefix }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const side = getAllianceSideRecord(props.record, props.prefix);
  if (!side || !hasAllianceSideSnapshotDetails(props.record, props.prefix)) return null;
  const extras = getAllianceSideSnapshotExtras(side);
  const heroes = open
    ? getAllianceSideHeroes(props.record, props.prefix).map(parseBattleHero).filter((h): h is BattleHeroDetail => h !== null)
    : [];

  return (
    <details className="mt-2 rounded-md border border-border bg-card/70 px-2 py-1 text-caption text-muted-foreground" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-foreground/80">阵容详情</summary>
      {open && (
        <div className="mt-2 space-y-2">
          {heroes.map((hero) => {
            const skills = hero.skills.map(formatSkillLabel).join(" / ");
            const warbooks = hero.warbooks.map(formatWarbookLabel).join(" / ");
            const equipment = formatAssetLabel("装备", hero.equipment.equipId, hero.equipment.name, hero.equipment.attrs);
            const horse = formatAssetLabel("马匹", hero.horse.horseId, hero.horse.name, hero.horse.attrs);
            return (
              <div key={`${hero.heroId}:${hero.position ?? ""}`} className="border-t border-border/70 pt-2 first:border-t-0 first:pt-0">
                <p className="text-foreground">{formatAllianceHeroHeader(hero)}</p>
                {formatAllianceHeroTroopDetail(hero) && <p>{formatAllianceHeroTroopDetail(hero)}</p>}
                {skills && <p>战法 {skills}</p>}
                {warbooks && <p>韬略 {warbooks}</p>}
                {equipment && <p>{equipment}</p>}
                {horse && <p>{horse}</p>}
              </div>
            );
          })}
          {extras.length > 0 && <p className="border-t border-border/70 pt-2">{extras.join(" · ")}</p>}
        </div>
      )}
    </details>
  );
}

export function AllianceSideCell(props: { record: JsonRecord; prefix: AllianceSidePrefix }): JSX.Element {
  const alliance = getAllianceSideAllianceName(props.record, props.prefix);
  const player = getAllianceSidePlayerName(props.record, props.prefix);
  const formation = formatAllianceFormationLabel(getAllianceSideFormationId(props.record, props.prefix), getAllianceSideFormationName(props.record, props.prefix));
  const lineup = getAllianceSideLineupDisplayLabel(props.record, props.prefix);
  const levels = getAllianceSideHeroLevels(props.record, props.prefix);
  const merit = getAllianceSideMerit(props.record, props.prefix);
  const troops = getAllianceSideTroopText(props.record, props.prefix);
  const meta = [levels.length > 0 ? `等级 ${levels.map((l) => `Lv.${l}`).join("/")}` : "", merit > 0 ? `武勋 ${formatCount(merit)}` : ""].filter(Boolean).join(" · ");
  const lines = [
    { text: alliance, className: "" },
    { text: player, className: "" },
    { text: formation, className: "text-primary" },
    { text: lineup, className: "text-foreground" },
    { text: meta, className: "text-foreground/80" },
    { text: troops, className: "text-foreground/80" },
  ].filter((l) => l.text);

  if (lines.length === 0 && !hasAllianceSideSnapshotDetails(props.record, props.prefix)) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="space-y-1 leading-5">
      {lines.map((line, i) => (
        <p key={`${props.prefix}:${i}:${line.text}`} className={line.className}>{line.text}</p>
      ))}
      <AllianceLineupSnapshotDetails record={props.record} prefix={props.prefix} />
    </div>
  );
}
