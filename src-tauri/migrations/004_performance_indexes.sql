-- 004_performance_indexes.sql
-- Composite indexes for window function deduplication and filtered queries.
-- Appended to database initialization after 002_indexes.sql.

-- Covering index for member snapshot deduplication queries.
-- Used by query_alliance_members() with ROW_NUMBER() OVER (PARTITION BY avatar_id ORDER BY observed_at DESC).
-- The DESC sort on observed_at matches the window function ORDER BY, letting SQLite skip a separate sort.
CREATE INDEX IF NOT EXISTS idx_member_snapshot_ws_avatar_time ON member_snapshot(workspace_id, avatar_id, observed_at DESC);

-- Covering index for building snapshot deduplication queries.
-- Used by query_alliance_facilities() with ROW_NUMBER() OVER (PARTITION BY building_name ORDER BY observed_at DESC).
CREATE INDEX IF NOT EXISTS idx_building_snapshot_ws_name_time ON building_snapshot(workspace_id, building_name, observed_at DESC);

-- Index for battle reports filtered by workspace and time range (query_battle_reports, query_battle_report_by_code).
-- The workspace_id prefix is the primary filter; occurred_at is the sort key.
CREATE INDEX IF NOT EXISTS idx_battle_block_ws_time ON battle_block(workspace_id, occurred_at);

-- Index for export jobs sorted by workspace and creation time (query_export_jobs).
-- Also covers status-filtered queries for pending/completed export monitoring.
CREATE INDEX IF NOT EXISTS idx_export_job_ws_status ON export_job(workspace_id, status);
