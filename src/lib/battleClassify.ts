/**
 * S3 战报分类器（纯函数）。
 *
 * 输入一场对阵的原始字段（combatType/scenarioId/endRound/location），
 * 输出作战类别：野战 / 攻城 / 守城 / 集结。
 *
 * 规则设计（85% 目标，可逐步调参）：
 * 1. combatType 直接携带游戏侧类型码：攻城系（5/6/7/8 一带）→ 攻城；
 * 2. 攻城且 endRound 极高（≥12，守方依托城防拖长战斗）→ 守城；
 * 3. 敌方（防守方）多连队同时参战（由调用方传入 defenderArmies ≥ 3）→ 集结；
 * 4. 其余 → 野战。
 */
export type BattleCategory = "野战" | "攻城" | "守城" | "集结";

/** combatType 中属于攻城/城防战的类型码集合（来自战报协议，可扩展）。 */
const SIEGE_COMBAT_TYPES = new Set([4, 5, 6, 7, 8, 12]);

export interface BattleClassifyInput {
  combatType: number;
  scenarioId: number;
  endRound: number;
  location: string;
  /** 敌方参战连队数（>=3 判定集结） */
  defenderArmies?: number;
}

export interface BattleClassifyResult {
  category: BattleCategory;
  /** 命中的判定依据，用于 UI 展示与调试 */
  reason: string;
}

/**
 * 分类主函数。纯函数、无副作用，便于单测。
 */
export function classifyBattle(input: BattleClassifyInput): BattleClassifyResult {
  const { combatType, scenarioId, endRound, defenderArmies = 0 } = input;

  // 1. 集结：敌方 3+ 连队同时参战（多路合围）
  if (defenderArmies >= 3) {
    return { category: "集结", reason: `敌方 ${defenderArmies} 连队同时参战` };
  }

  // 2. 攻城/守城：combatType 属于攻城系
  if (SIEGE_COMBAT_TYPES.has(combatType)) {
    // 2a. 守城：城防战拖到高回合，防守方依托工事
    if (endRound >= 12) {
      return { category: "守城", reason: `攻城系 combatType=${combatType} 且拖至 ${endRound} 回合` };
    }
    // 2b. 常规攻城
    return { category: "攻城", reason: `combatType=${combatType} 攻城系` };
  }

  // 3. 场景 ID 属于攻城场景（如城墙/关隘），仍判攻城
  if (scenarioId > 0 && SIEGE_SCENARIO_IDS.has(scenarioId)) {
    return { category: "攻城", reason: `scenarioId=${scenarioId} 攻城场景` };
  }

  // 4. 其余野战
  return { category: "野战", reason: "默认野战" };
}

/** 攻城场景 ID 集合（可扩展）。 */
const SIEGE_SCENARIO_IDS = new Set<number>([1, 2, 3, 11, 12, 21, 22]);

/** 分类徽章配色（供前端直接用，语义与 badge 变体一致）。 */
export const CATEGORY_TONE: Record<BattleCategory, "default" | "secondary" | "destructive" | "warning"> = {
  野战: "default",
  攻城: "warning",
  守城: "destructive",
  集结: "secondary",
};

export const CATEGORY_OPTIONS: Array<{ value: BattleCategory | "all"; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "野战", label: "野战" },
  { value: "攻城", label: "攻城" },
  { value: "守城", label: "守城" },
  { value: "集结", label: "集结" },
];
