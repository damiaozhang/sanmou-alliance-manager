-- 005_battle_classification.sql
-- 战报分类字段：为 lineup_matchup 增加战斗分类维度列（S3 战报分类入库）
--
-- 设计说明：
--   * 全部使用 ALTER TABLE ADD COLUMN，SQLite 向后兼容，003 的 UNIQUE 约束不变，
--     不触发表重建，旧库升级安全。
--   * 实际执行走 db.rs 的 ensure_table_column（幂等，列已存在则跳过），
--     本文件仅作迁移清单文档化记录，与 001~004 保持一致。
--
-- match_type : 战斗模式（1 野战 / 2 攻城 / 3 守城 / 4 集结）
-- combat_type: 战斗类型原始码（来自战报 JSON combatType，0 表示未知）
-- scenario_id: 场景 ID（来自战报 JSON scenarioId，0 表示未知）
-- end_round  : 实际结束回合数（来自战报 JSON endRound）
-- location   : 战斗地点坐标（来自战报 JSON location，如 "x,y"）

ALTER TABLE lineup_matchup ADD COLUMN match_type INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lineup_matchup ADD COLUMN combat_type INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lineup_matchup ADD COLUMN scenario_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lineup_matchup ADD COLUMN end_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lineup_matchup ADD COLUMN location TEXT NOT NULL DEFAULT '';
