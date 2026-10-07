/**
 * S2 敌方画像：玩家档案页的纯函数聚合逻辑。
 * 从现有 LineupStat/LineupMatchup 数据中提炼主队、副队与换阵时间线。
 * 无副作用、无 React 依赖，便于单测。
 */

import type { LineupAnalysisBundle } from "../tauri";

type Stat = NonNullable<LineupAnalysisBundle["stats"]>[number];
type Matchup = NonNullable<LineupAnalysisBundle["matchups"]>[number];

export interface MainLineupInfo {
  main: Stat | null;
  alternates: Stat[];
}

/** 主队识别：按场次降序取使用最多的阵容；副队场次 ≥ 主队 30% 才算常驻。 */
export function pickMainLineups(stats: Stat[]): MainLineupInfo {
  const sorted = [...stats].sort((a, b) => b.battles - a.battles);
  const [main, ...rest] = sorted;
  const alternates = main ? rest.filter((s) => s.battles >= main.battles * 0.3) : [];
  return { main: main ?? null, alternates };
}

/** 该玩家主队胜率（平局计半胜），无数据返回 0。 */
export function lineupWinRate(stat: Stat | null): number {
  if (!stat || stat.battles <= 0) return 0;
  return (stat.wins + stat.draws * 0.5) / stat.battles;
}

export interface LineupChange {
  time: string;
  from: string;
  to: string;
}

/**
 * 换阵时间线：按 battleTime 排序，相邻出场 lineup_key 不同则记一次换阵。
 * 只统计该玩家自身（攻击/防守任一侧）的阵容切换。
 */
export function buildLineupChangeTimeline(matchups: Matchup[], avatarId: string): LineupChange[] {
  const own = matchups
    .map((m) => ({
      time: m.battleTime,
      key: m.attackerAvatarId === avatarId ? m.attackerLineupKey : m.defenderLineupKey,
      label:
        m.attackerAvatarId === avatarId
          ? m.attackerLineupLabel || m.attackerLineupKey
          : m.defenderLineupLabel || m.defenderLineupKey,
    }))
    .filter((e) => e.key)
    .sort((a, b) => a.time.localeCompare(b.time));

  const changes: LineupChange[] = [];
  for (let i = 1; i < own.length; i += 1) {
    if (own[i].key !== own[i - 1].key) {
      changes.push({ time: own[i].time, from: own[i - 1].label, to: own[i].label });
    }
  }
  return changes;
}
