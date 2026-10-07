import type { BattleAttr, BattleHeroDetail, BattleSkill, BattleTeamDetail, BattleWarbook } from "../types";
import { AUTHORITATIVE_HORSE_EFFECT_NAMES, AUTHORITATIVE_HORSE_NAMES, AUTHORITATIVE_HORSE_SKILL_NAMES, AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES, AUTHORITATIVE_EQUIPMENT_NAMES, AUTHORITATIVE_EQUIPMENT_SKILL_NAMES, AUTHORITATIVE_SKILL_NAMES, AUTHORITATIVE_WARBOOK_NAMES } from "../constants";
import { asId } from "./helpers";

export function formatTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function formatCount(value: number | null | undefined): string {
  // 非法/未知值返回「—」，与项目「无数据不显示 0」原则一致（避免把未知伪装成 0 兵/0 武勋）
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString('zh-CN') : "—";
}

export function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

export function formatOptionalNumber(value: number | null): string {
  return value === null ? "-" : formatCount(value);
}

export function formatRedLabel(value: unknown): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
  return n !== null && Number.isFinite(n) ? `${n}红` : "";
}

export function lookupTerm(terms: Record<string, string>, value: unknown): string {
  const key = asId(value);
  return key ? terms[key] ?? "" : "";
}

export function lookupAssetName(kind: string, id: unknown): string {
  if (kind === "装备") return lookupTerm(AUTHORITATIVE_EQUIPMENT_NAMES, id);
  if (kind === "马匹") return lookupTerm(AUTHORITATIVE_HORSE_NAMES, id);
  return "";
}

export function lookupAssetAttrName(kind: string, attr: BattleAttr): string {
  if (attr.key !== "skill" && attr.key !== "effect") return "";
  if (kind === "装备") {
    return lookupTerm(attr.key === "skill" ? AUTHORITATIVE_EQUIPMENT_SKILL_NAMES : AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES, attr.value);
  }
  if (kind === "马匹") {
    return lookupTerm(attr.key === "skill" ? AUTHORITATIVE_HORSE_SKILL_NAMES : AUTHORITATIVE_HORSE_EFFECT_NAMES, attr.value);
  }
  return "";
}

export function isAssetStatAttr(attr: BattleAttr): boolean {
  return ["might", "intelligence", "defence", "defense", "speed"].includes(attr.key);
}

export function formatAttrLabel(kind: string, attr: BattleAttr): string {
  const label = attr.label || attr.key || "属性";
  const name = attr.name || lookupAssetAttrName(kind, attr);
  if (name) return `${label}: ${name}`;
  if (attr.key === "skill" || attr.key === "effect") return "";
  if (isAssetStatAttr(attr)) return "";
  return attr.value ? `${label}: ${attr.value}` : label;
}

export function formatAssetLabel(kind: string, id: string, name: string, attrs: BattleAttr[]): string {
  const displayName = name || lookupAssetName(kind, id);
  const head = displayName ? `${kind} ${displayName}${id ? ` (#${id})` : ""}` : id ? `${kind} #${id}` : "";
  const attrText = attrs.map((attr) => formatAttrLabel(kind, attr)).filter(Boolean).join(" / ");
  return [head, attrText].filter(Boolean).join(" · ");
}

export function formatSkillLabel(skill: BattleSkill): string {
  const name = skill.name || lookupTerm(AUTHORITATIVE_SKILL_NAMES, skill.skillId) || (skill.skillId ? `战法 #${skill.skillId}` : "未知战法");
  const meta = [
    skill.level !== null ? `Lv.${skill.level}` : "",
    skill.orderLevel !== null ? `品 ${skill.orderLevel}` : "",
    skill.position !== null && skill.position > 0 ? `槽位 ${skill.position}` : "",
    skill.showReplace ? "替换展示" : "",
  ].filter(Boolean);
  return meta.length ? `${name} (${meta.join(" / ")})` : name;
}

export function formatWarbookLabel(warbook: BattleWarbook): string {
  return warbook.name || lookupTerm(AUTHORITATIVE_WARBOOK_NAMES, warbook.warbookId) || (warbook.warbookId ? `韬略 #${warbook.warbookId}` : "未知韬略");
}

export function normaliseFormationName(value: string): string {
  return value.trim().replace(/\s*#\d+$/, "").trim();
}

export function formatAllianceFormationLabel(formationId: string, formationName = ""): string {
  const clean = normaliseFormationName(formationName);
  if (clean) return clean;
  return formationId ? `阵型#${formationId}` : "";
}

export function formatBattleHeroShort(hero: BattleHeroDetail): string {
  return [hero.displayName, formatRedLabel(hero.evolution)].filter(Boolean).join(" ");
}

export function formatBattleLineup(team: BattleTeamDetail | null): string {
  if (!team || team.heroes.length === 0) return "-";
  return [...team.heroes]
    .sort((l, r) => (l.position ?? 99) - (r.position ?? 99))
    .map(formatBattleHeroShort)
    .join(" / ");
}

export function formatBattleTeamOwner(team: BattleTeamDetail | null): string {
  if (!team) return "-";
  const player = team.player.name || (team.player.avatarId ? `玩家 #${team.player.avatarId}` : "未知玩家");
  return team.player.allianceName ? `${player} / ${team.player.allianceName}` : player;
}

export function formatBattleLoss(team: BattleTeamDetail | null): string {
  if (!team) return "-";
  const origin = team.totals.originTroops;
  const remaining = team.totals.remainingTroops;
  const lost = Math.max(0, origin - remaining);
  const rate = origin > 0 ? `，损失 ${formatPercent(lost / origin)}` : "";
  return `${formatCount(remaining)}/${formatCount(origin)}${rate}`;
}

export function formatBattleLocation(location: unknown[]): string {
  if (location.length === 0) return "-";
  return location
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      return JSON.stringify(item);
    })
    .filter((item) => item.length > 0)
    .join(" / ");
}

export function formatAllianceHeroHeader(hero: BattleHeroDetail): string {
  const levelText = hero.level !== null ? `Lv.${hero.level}` : "";
  return [hero.displayName, levelText, formatRedLabel(hero.evolution)].filter(Boolean).join(" ");
}

export function formatAllianceHeroTroopDetail(hero: BattleHeroDetail): string {
  const troopText =
    hero.remainingTroops !== null && hero.originTroops !== null
      ? `${formatCount(hero.remainingTroops)}/${formatCount(hero.originTroops)}`
      : "";
  return [troopText, hero.wounded !== null ? `伤${formatCount(hero.wounded)}` : "", hero.dead !== null ? `亡${formatCount(hero.dead)}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function formatAverageCount(total: number, battles: number): string {
  return battles > 0 ? formatCount(Math.round(total / battles)) : "-";
}

export function formatAverageEvolution(totalEvolution: number, evolutionCount: number): string {
  return evolutionCount > 0 ? `${(totalEvolution / evolutionCount).toFixed(1)}红` : "-";
}

export function formatAverageHeroLevel(totalHeroLevel: number, heroLevelCount: number): string {
  return heroLevelCount > 0 ? `Lv.${(totalHeroLevel / heroLevelCount).toFixed(1)}` : "-";
}

export function formatTotalMerit(totalMerit: number): string {
  return totalMerit > 0 ? formatCount(totalMerit) : "-";
}

export function formatRemainingRate(totalRemainingTroops: number, totalOriginTroops: number): string {
  return totalOriginTroops > 0 ? formatPercent(totalRemainingTroops / totalOriginTroops) : "-";
}

export function formatOwnLossRate(totalDead: number, totalWounded: number, totalOriginTroops: number): string {
  return totalOriginTroops > 0 ? formatPercent((totalDead + totalWounded) / totalOriginTroops) : "-";
}

export function formatEnemyLossRate(totalEnemyDead: number, totalEnemyWounded: number, totalEnemyOriginTroops: number): string {
  return totalEnemyOriginTroops > 0 ? formatPercent((totalEnemyDead + totalEnemyWounded) / totalEnemyOriginTroops) : "-";
}

export function formatLossExchangeRatio(
  totalDead: number, totalWounded: number, totalOriginTroops: number,
  totalEnemyDead: number, totalEnemyWounded: number, totalEnemyOriginTroops: number
): string {
  const own = totalOriginTroops > 0 ? (totalDead + totalWounded) / totalOriginTroops : 0;
  const enemy = totalEnemyOriginTroops > 0 ? (totalEnemyDead + totalEnemyWounded) / totalEnemyOriginTroops : 0;
  if (own <= 0) return enemy > 0 ? "∞x" : "-";
  return `${(enemy / own).toFixed(2)}x`;
}
