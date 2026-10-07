-- 006_indexes.sql
-- 补充查询索引：
--   * lineup_matchup 时间线按 battle_time 排序（BattleTimelinePage / PlayerProfilePage 高频查询，
--     现有 idx_lineup_matchup_workspace 只覆盖 (workspace_id, attacker_lineup_key, defender_lineup_key)）
CREATE INDEX IF NOT EXISTS idx_lineup_matchup_workspace_time
    ON lineup_matchup(workspace_id, battle_time DESC);
