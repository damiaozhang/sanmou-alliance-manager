// 阵容草稿类型（阶段4 自 helpers.ts 拆出）

export type LineupDraft = {
  playerName: string;
  playerAvatarId: string;
  label: string;
  heroes: string;
  confidence: string;
  notes: string;
  sourceBattleId: string;
};
