use crate::error::{AppError, AppResult};
use crate::models::{
    AllianceFacilityRow, AllianceGroupRow, AllianceLogRow, AllianceMemberRow, BattleReportRow,
    BuildingSnapshotRow, CaptureManifestArtifactSummary, CapturePreviewCounts,
    CaptureSessionCapture, CaptureSessionRow, CaptureSessionSummaryRecord, CollectorCapturePayload,
    CrossWorkspacePowerPoint, ExportJobRow, IntelEntryRow, IntelSnapshotRow, LineupMatchupRow,
    LineupProfileRow,
    LineupStatRow, MemberActivityAlertRow, MemberActivityAlerts, MemberBindingRow,
    MemberSnapshotRow, PagedAllianceLogs, PagedBattleReports, PagedIntelEntries,
    PagedIntelSnapshots, PagedMemberSnapshots,
    RawArtifactRow,
};
use chrono::{Local, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;

use super::Database;

/// 分页参数钳制：limit 钳到 [1, 500]（防止前端误传 0/负数/超大值拖垮查询），
/// offset 钳到非负。
fn normalize_page(limit: i64, offset: i64) -> (i64, i64) {
    (limit.clamp(1, 500), offset.max(0))
}

/// alliance_intel_snapshot 行 → IntelSnapshotRow
/// （列顺序固定：id, workspace_id, alliance_id, kind, subject_key, subject_label,
/// observed_at, entry_count, metrics_json, source_func）
fn map_intel_snapshot_row(row: &Row<'_>) -> rusqlite::Result<IntelSnapshotRow> {
    Ok(IntelSnapshotRow {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        alliance_id: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
        kind: row.get(3)?,
        subject_key: row.get(4)?,
        subject_label: row.get(5)?,
        observed_at: row.get(6)?,
        entry_count: row.get(7)?,
        metrics_json: row.get(8)?,
        source_func: row.get(9)?,
    })
}

/// alliance_intel_entry 行 → IntelEntryRow
/// （列顺序固定：id, snapshot_id, kind, rank, subject_key, name, union_name, value, extra_json）
fn map_intel_entry_row(row: &Row<'_>) -> rusqlite::Result<IntelEntryRow> {
    Ok(IntelEntryRow {
        id: row.get(0)?,
        snapshot_id: row.get(1)?,
        kind: row.get(2)?,
        rank: row.get(3)?,
        subject_key: row.get(4)?,
        name: row.get(5)?,
        union_name: row.get(6)?,
        value: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
        extra_json: row.get(8)?,
    })
}

/// battle_block 行 → BattleReportRow 的映射（列顺序固定为
/// workspace_id, alliance_id, battle_id, battle_code, occurred_at, location,
/// match_type, result, winner_side, attacker_json, defender_json,
/// battlefield_environment_json, end_round）。
fn map_battle_report_row(row: &Row<'_>) -> rusqlite::Result<BattleReportRow> {
    let workspace_id: i64 = row.get(0)?;
    let alliance_id: i64 = row.get(1)?;
    let battle_id: String = row.get(2)?;
    let battle_code: String = row.get(3)?;
    let occurred_at: String = row.get(4)?;
    let location: String = row.get(5)?;
    let _match_type: i64 = row.get(6)?;
    let result: String = row.get(7)?;
    let _winner_side: String = row.get(8)?;
    let attacker_json: String = row.get(9)?;
    let defender_json: String = row.get(10)?;
    let battlefield_environment_json: String = row.get(11)?;
    let end_round: i64 = row.get(12)?;

    let lineup = serde_json::from_str::<Value>(&attacker_json)
        .ok()
        .and_then(|value| {
            value
                .get("lineup")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "未知".to_string());
    let enemy_player = serde_json::from_str::<Value>(&defender_json)
        .ok()
        .and_then(|value| {
            value
                .get("playerName")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "未知".to_string());
    let enemy = serde_json::from_str::<Value>(&battlefield_environment_json)
        .ok()
        .and_then(|value| {
            value
                .get("enemyAlliance")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "未知".to_string());

    Ok(BattleReportRow {
        workspace_id: Some(workspace_id),
        alliance_id: Some(alliance_id),
        time: occurred_at,
        battle_code,
        enemy,
        enemy_player,
        result,
        round: end_round,
        location,
        lineup,
        battle_id,
        battlefield_environment_json,
    })
}

/// member_snapshot 行 → MemberSnapshotRow 的映射（28 列，列顺序与
/// query_member_snapshots / query_member_snapshots_paged 的 SELECT 一致，
/// 最后一列 raw_json 由调用方决定内容）。
fn map_member_snapshot_row(row: &Row<'_>) -> rusqlite::Result<MemberSnapshotRow> {
    Ok(MemberSnapshotRow {
        id: row.get(0)?,
        capture_session_id: row.get(1)?,
        observed_at: row.get(2)?,
        avatar_id: row.get(3)?,
        avatar_name: row.get(4)?,
        official_name: row.get(5)?,
        profession_name: row.get(6)?,
        profession_id: row.get(7)?,
        state: row.get(8)?,
        is_online: row.get(9)?,
        role_id: row.get(10)?,
        legion_name: row.get(11)?,
        legion_id: row.get(12)?,
        legion_leader: row.get(13)?,
        prosperity: row.get(14)?,
        weekly_contribution: row.get(15)?,
        weekly_merit: row.get(16)?,
        season_score: row.get(17)?,
        demolition_value: row.get(18)?,
        coordinate_x: row.get(19)?,
        coordinate_y: row.get(20)?,
        last_offline_ts: row.get(21)?,
        join_ts: row.get(22)?,
        t_feat: row.get(23)?,
        t_forage_use: row.get(24)?,
        w_forage_use: row.get(25)?,
        weekly_statistics_json: row.get(26)?,
        raw_json: row.get(27)?,
    })
}

impl Database {
    pub fn query_member_activity_alerts(
        &self,
        workspace_id: i64,
        offline_days: i64,
        bottom_n: i64,
    ) -> AppResult<MemberActivityAlerts> {
        let conn = self.conn();
        // P2：offline_days 来自 IPC，此前只做下界 max(0)：传入巨值会在 debug 下
        // 溢出 panic、release 下静默回绕，导致告警结果错乱。这里限定到 0..=3650
        // 天并用 checked_mul 兜底。
        let offline_days = offline_days.clamp(0, 3650);
        let offset_seconds = offline_days
            .checked_mul(86_400)
            .ok_or_else(|| AppError::Message("offline_days 超出范围".to_string()))?;
        let cutoff_ts = Utc::now().timestamp() - offset_seconds;
        let mut statement = conn.prepare(
            "SELECT avatar_id, avatar_name, COALESCE(official_name, ''),
                    COALESCE(weekly_contribution, 0), COALESCE(weekly_merit, 0),
                    last_offline_ts, observed_at
             FROM (
                 SELECT avatar_id, avatar_name, official_name, weekly_contribution, weekly_merit,
                        last_offline_ts, observed_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY avatar_id
                            ORDER BY observed_at DESC, id DESC
                        ) AS rn
                 FROM member_snapshot
                 WHERE workspace_id = ?1
             )
             WHERE rn = 1",
        )?;
        let rows = statement
            .query_map(params![workspace_id], |row| {
                Ok(MemberActivityAlertRow {
                    avatar_id: row.get(0)?,
                    avatar_name: row.get(1)?,
                    official_name: row.get(2)?,
                    weekly_contribution: row.get(3)?,
                    weekly_merit: row.get(4)?,
                    last_offline_ts: row.get(5)?,
                    observed_at: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut offline_members: Vec<MemberActivityAlertRow> = rows
            .iter()
            .filter(|row| row.last_offline_ts > 0 && row.last_offline_ts < cutoff_ts)
            .cloned()
            .collect();
        offline_members.sort_by_key(|row| row.last_offline_ts);

        let mut low_contribution = rows;
        low_contribution.sort_by_key(|row| row.weekly_contribution);
        low_contribution.truncate(bottom_n.max(0) as usize);

        Ok(MemberActivityAlerts {
            offline_members,
            low_contribution,
        })
    }

    pub fn query_cross_workspace_power_series(&self) -> AppResult<Vec<CrossWorkspacePowerPoint>> {
        let conn = self.conn();
        // ?? (workspace, avatar, ?) ???????????????????????????
        // 注意：此处 substr(observed_at,1,10) 是日期分桶（PARTITION/GROUP BY 键），
        // 不是 WHERE 过滤条件，无法用范围比较替代；查询无 WHERE 全表聚合，
        // 日期键仅从已有 RFC3339 字符串前缀推导，不额外扫索引。
        let mut statement = conn.prepare(
            "WITH ranked AS (
                 SELECT workspace_id, avatar_id, weekly_merit, season_score,
                        substr(observed_at, 1, 10) AS observed_date,
                        ROW_NUMBER() OVER (
                            PARTITION BY workspace_id, avatar_id, substr(observed_at, 1, 10)
                            ORDER BY observed_at DESC, id DESC
                        ) AS rn
                 FROM member_snapshot
             )
             SELECT ranked.workspace_id,
                    COALESCE(workspace.name, '') AS workspace_name,
                    ranked.observed_date,
                    COUNT(*) AS member_count,
                    COALESCE(SUM(ranked.weekly_merit), 0) AS total_weekly_merit,
                    COALESCE(SUM(ranked.season_score), 0) AS total_season_score
             FROM ranked
             LEFT JOIN workspace ON workspace.id = ranked.workspace_id
             WHERE ranked.rn = 1
             GROUP BY ranked.workspace_id, ranked.observed_date
             ORDER BY ranked.workspace_id ASC, ranked.observed_date ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(CrossWorkspacePowerPoint {
                workspace_id: row.get(0)?,
                workspace_name: row.get(1)?,
                date: row.get(2)?,
                member_count: row.get(3)?,
                total_weekly_merit: row.get(4)?,
                total_season_score: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    /// 战报分页查询（阶段3a 分片命令 get_battle_reports_paged 的底层实现）。
    /// 走 idx_battle_block_ws_time (workspace_id, occurred_at) 索引；
    /// from/to 为 RFC3339 时间戳字符串，语义为 [from, to)，None 表示不限。
    pub fn query_battle_reports_paged(
        &self,
        workspace_id: i64,
        from: Option<&str>,
        to: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> AppResult<PagedBattleReports> {
        let (limit, offset) = normalize_page(limit, offset);
        let conn = self.conn();
        let mut statement = conn.prepare(
            "SELECT workspace_id, alliance_id, battle_id, battle_code, occurred_at, location, match_type, result, winner_side,
                    attacker_json, defender_json, battlefield_environment_json, end_round
             FROM battle_block
             WHERE workspace_id = ?1
               AND (?2 IS NULL OR occurred_at >= ?2)
               AND (?3 IS NULL OR occurred_at < ?3)
             ORDER BY occurred_at DESC, id DESC
             LIMIT ?4 OFFSET ?5",
        )?;
        let rows = statement
            .query_map(params![workspace_id, from, to, limit, offset], map_battle_report_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM battle_block
             WHERE workspace_id = ?1
               AND (?2 IS NULL OR occurred_at >= ?2)
               AND (?3 IS NULL OR occurred_at < ?3)",
            params![workspace_id, from, to],
            |row| row.get(0),
        )?;
        Ok(PagedBattleReports { rows, total })
    }

    /// 同盟日志分页查询（阶段3a 分片命令 get_alliance_logs_paged 的底层实现）。
    /// 排序/过滤走 idx_union_log_event_workspace_time (workspace_id, event_time DESC)，
    /// section 为可选的 log_section 等值过滤（如 "成员"/"攻城"/"管理"/"other"）。
    pub fn query_alliance_logs_paged(
        &self,
        workspace_id: i64,
        section: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> AppResult<PagedAllianceLogs> {
        let (limit, offset) = normalize_page(limit, offset);
        let conn = self.conn();
        let mut statement = conn.prepare(
            "SELECT capture_session_id, event_time, log_category, log_section, actor_name,
                    COALESCE(target_name, ''), text
             FROM union_log_event
             WHERE workspace_id = ?1
               AND (?2 IS NULL OR log_section = ?2)
             ORDER BY event_time DESC, id DESC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = statement
            .query_map(params![workspace_id, section, limit, offset], |row| {
                Ok(AllianceLogRow {
                    capture_session_id: row.get(0)?,
                    time: row.get(1)?,
                    category: row.get(2)?,
                    section: row.get(3)?,
                    actor: row.get(4)?,
                    target: row.get(5)?,
                    text: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM union_log_event
             WHERE workspace_id = ?1
               AND (?2 IS NULL OR log_section = ?2)",
            params![workspace_id, section],
            |row| row.get(0),
        )?;
        Ok(PagedAllianceLogs { rows, total })
    }

    /// 同盟情报快照分页查询（get_intel_snapshots 的底层实现）。
    /// `kind` 为 None 时返回全部类型；`payload_json` 是大字段，一律不随分页返回
    /// （原始载荷仍留在库中，供协议演进后重放解析）。
    pub fn query_intel_snapshots_paged(
        &self,
        workspace_id: i64,
        kind: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> AppResult<PagedIntelSnapshots> {
        let (limit, offset) = normalize_page(limit, offset);
        let conn = self.conn();
        let kind_filter = kind.map(str::trim).filter(|value| !value.is_empty());
        let columns = "id, workspace_id, alliance_id, kind, subject_key, subject_label,
                       observed_at, entry_count, metrics_json, source_func";
        let (rows, total) = match kind_filter {
            Some(kind) => {
                let mut statement = conn.prepare(&format!(
                    "SELECT {columns} FROM alliance_intel_snapshot
                     WHERE workspace_id = ?1 AND kind = ?2
                     ORDER BY observed_at DESC, id DESC
                     LIMIT ?3 OFFSET ?4"
                ))?;
                let rows = statement
                    .query_map(params![workspace_id, kind, limit, offset], map_intel_snapshot_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                let total: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM alliance_intel_snapshot WHERE workspace_id = ?1 AND kind = ?2",
                    params![workspace_id, kind],
                    |row| row.get(0),
                )?;
                (rows, total)
            }
            None => {
                let mut statement = conn.prepare(&format!(
                    "SELECT {columns} FROM alliance_intel_snapshot
                     WHERE workspace_id = ?1
                     ORDER BY observed_at DESC, id DESC
                     LIMIT ?2 OFFSET ?3"
                ))?;
                let rows = statement
                    .query_map(params![workspace_id, limit, offset], map_intel_snapshot_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                let total: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM alliance_intel_snapshot WHERE workspace_id = ?1",
                    params![workspace_id],
                    |row| row.get(0),
                )?;
                (rows, total)
            }
        };
        Ok(PagedIntelSnapshots { rows, total })
    }

    /// 情报快照明细分页：按 rank 升序（rank=0 的排在最后，按 id 升序）。
    pub fn query_intel_entries(
        &self,
        workspace_id: i64,
        snapshot_id: i64,
        limit: i64,
        offset: i64,
    ) -> AppResult<PagedIntelEntries> {
        let (limit, offset) = normalize_page(limit, offset);
        let conn = self.conn();
        let mut statement = conn.prepare(
            "SELECT id, snapshot_id, kind, rank, subject_key, name, union_name, value, extra_json
             FROM alliance_intel_entry
             WHERE workspace_id = ?1 AND snapshot_id = ?2
             ORDER BY CASE WHEN rank > 0 THEN 0 ELSE 1 END, rank ASC, id ASC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = statement
            .query_map(
                params![workspace_id, snapshot_id, limit, offset],
                map_intel_entry_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM alliance_intel_entry WHERE workspace_id = ?1 AND snapshot_id = ?2",
            params![workspace_id, snapshot_id],
            |row| row.get(0),
        )?;
        Ok(PagedIntelEntries { rows, total })
    }

    /// 成员快照分页查询（阶段3a 分片命令 get_member_snapshots 的底层实现）。
    /// latest_only=true 时按 avatar_id 去重只取每人最新一条（total 为去重后人数），
    /// 否则返回全量历史快照（total 为行数）；排序走
    /// idx_member_snapshot_workspace_time (workspace_id, observed_at DESC)。
    /// raw_json 大字段一律不随分页返回（固定 '{}'），原始数据仍在库中。
    pub fn query_member_snapshots_paged(
        &self,
        workspace_id: i64,
        latest_only: bool,
        limit: i64,
        offset: i64,
    ) -> AppResult<PagedMemberSnapshots> {
        let (limit, offset) = normalize_page(limit, offset);
        let conn = self.conn();
        let columns = "id, capture_session_id, observed_at, avatar_id, avatar_name, official_name,
                profession_name, profession_id, state,
                is_online, role_id, legion_name, legion_id, legion_leader, prosperity,
                weekly_contribution, weekly_merit, season_score, demolition_value, coordinate_x,
                coordinate_y, last_offline_ts, join_ts, t_feat, t_forage_use, w_forage_use,
                weekly_statistics_json";
        let (rows, total) = if latest_only {
            let sql = format!(
                "WITH ranked AS (
                     SELECT {columns},
                            ROW_NUMBER() OVER (
                                PARTITION BY avatar_id
                                ORDER BY observed_at DESC, id DESC
                            ) AS rn
                     FROM member_snapshot
                     WHERE workspace_id = ?1
                 )
                 SELECT {columns}, '{{}}' AS raw_json
                 FROM ranked
                 WHERE rn = 1
                 ORDER BY observed_at DESC, id DESC
                 LIMIT ?2 OFFSET ?3"
            );
            let mut statement = conn.prepare(&sql)?;
            let rows = statement
                .query_map(params![workspace_id, limit, offset], map_member_snapshot_row)?
                .collect::<Result<Vec<_>, _>>()?;
            let total: i64 = conn.query_row(
                "SELECT COUNT(DISTINCT avatar_id) FROM member_snapshot WHERE workspace_id = ?1",
                params![workspace_id],
                |row| row.get(0),
            )?;
            (rows, total)
        } else {
            let sql = format!(
                "SELECT {columns}, '{{}}' AS raw_json
                 FROM member_snapshot
                 WHERE workspace_id = ?1
                 ORDER BY observed_at DESC, id DESC
                 LIMIT ?2 OFFSET ?3"
            );
            let mut statement = conn.prepare(&sql)?;
            let rows = statement
                .query_map(params![workspace_id, limit, offset], map_member_snapshot_row)?
                .collect::<Result<Vec<_>, _>>()?;
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM member_snapshot WHERE workspace_id = ?1",
                params![workspace_id],
                |row| row.get(0),
            )?;
            (rows, total)
        };
        Ok(PagedMemberSnapshots { rows, total })
    }
}

pub(super) fn query_alliance_members(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<AllianceMemberRow>> {
    let mut statement = connection.prepare(
        "SELECT avatar_id, avatar_name, official_name, profession_name, is_online, legion_name, prosperity, weekly_contribution,
                weekly_merit, season_score, last_offline_ts, demolition_value, coordinate_x, coordinate_y, state
         FROM (
             SELECT avatar_id, avatar_name, official_name, profession_name, is_online, legion_name, prosperity, weekly_contribution,
                    weekly_merit, season_score, last_offline_ts, demolition_value, coordinate_x, coordinate_y, state,
                    ROW_NUMBER() OVER (
                        PARTITION BY avatar_id
                        ORDER BY observed_at DESC, id DESC
                    ) AS rn
             FROM member_snapshot
             WHERE (?1 IS NULL OR workspace_id = ?1)
         )
         WHERE rn = 1
         ORDER BY weekly_contribution DESC, avatar_name ASC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        let x: i64 = row.get(12)?;
        let y: i64 = row.get(13)?;
        Ok(AllianceMemberRow {
            avatar_id: row.get(0)?,
            name: row.get(1)?,
            official: row.get(2)?,
            profession: row.get(3)?,
            is_online: row.get(4)?,
            legion: row.get(5)?,
            prosperity: row.get(6)?,
            contribution: row.get(7)?,
            merit: row.get(8)?,
            season_score: row.get(9)?,
            last_offline_ts: row.get(10)?,
            demolition: row.get(11)?,
            coord: format!("{x},{y}"),
            status: row.get(14)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_alliance_logs(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<AllianceLogRow>> {
    let mut statement = connection.prepare(
        "SELECT capture_session_id, event_time, log_category, log_section, actor_name, COALESCE(target_name, ''), text
         FROM union_log_event
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY event_time DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        Ok(AllianceLogRow {
            capture_session_id: row.get(0)?,
            time: row.get(1)?,
            category: row.get(2)?,
            section: row.get(3)?,
            actor: row.get(4)?,
            target: row.get(5)?,
            text: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_alliance_facilities(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<AllianceFacilityRow>> {
    let mut statement = connection.prepare(
        "SELECT building_name, facility_type, cfg_id, carrier_id, level, state, coordinate_x,
                coordinate_y, operator_name, benefit, effect
         FROM (
             SELECT building_name, facility_type, cfg_id, carrier_id, level, state, coordinate_x,
                    coordinate_y, operator_name, benefit, effect,
                    ROW_NUMBER() OVER (
                        PARTITION BY building_name
                        ORDER BY observed_at DESC, id DESC
                    ) AS rn
             FROM building_snapshot
             WHERE (?1 IS NULL OR workspace_id = ?1)
         )
         WHERE rn = 1
         ORDER BY building_name ASC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        let x: i64 = row.get(6)?;
        let y: i64 = row.get(7)?;
        Ok(AllianceFacilityRow {
            name: row.get(0)?,
            facility_type: row.get(1)?,
            cfg_id: row.get(2)?,
            carrier_id: row.get(3)?,
            level: row.get(4)?,
            state: row.get(5)?,
            coord: format!("{x},{y}"),
            operator_name: row.get(8)?,
            benefit: row.get(9)?,
            effect: row.get(10)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_alliance_groups(
    connection: &Connection,
    workspace_id: Option<i64>,
    include_raw_json: bool,
) -> AppResult<Vec<AllianceGroupRow>> {
    let mut statement = connection.prepare(
        "SELECT capture_session_id, group_id, group_name, legion_id, legion_name, member_count, observed_at,
                CASE WHEN ?2 THEN raw_json ELSE '{}' END AS raw_json
         FROM union_group
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY observed_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id, include_raw_json], |row| {
        Ok(AllianceGroupRow {
            capture_session_id: row.get(0)?,
            group_id: row.get(1)?,
            group_name: row.get(2)?,
            legion_id: row.get(3)?,
            legion_name: row.get(4)?,
            member_count: row.get(5)?,
            observed_at: row.get(6)?,
            raw_json: row.get(7)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_member_snapshots(
    connection: &Connection,
    workspace_id: Option<i64>,
    include_raw_json: bool,
) -> AppResult<Vec<MemberSnapshotRow>> {
    let mut statement = connection.prepare(
        "SELECT id, capture_session_id, observed_at, avatar_id, avatar_name, official_name,
                profession_name, profession_id, state,
                is_online, role_id, legion_name, legion_id, legion_leader, prosperity,
                weekly_contribution, weekly_merit, season_score, demolition_value, coordinate_x,
                coordinate_y, last_offline_ts, join_ts, t_feat, t_forage_use, w_forage_use,
                weekly_statistics_json,
                CASE WHEN ?2 THEN raw_json ELSE '{}' END AS raw_json
         FROM member_snapshot
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY observed_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id, include_raw_json], map_member_snapshot_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 取每个成员**最新一条**快照（按 `avatar_id` 分组取最新）。
/// 2026-09-20 修复（审查 P1-8）：`member_snapshot` 每次采集都会追加一行，
/// 「成员数据」类导出若直接走 `query_member_snapshots` 会把同一成员按历次
/// 采集重复输出多行——看起来像重复数据。导出应使用本函数（等价于界面上的
/// latest 视图）。
pub(super) fn query_latest_member_snapshots(
    connection: &Connection,
    workspace_id: Option<i64>,
    include_raw_json: bool,
) -> AppResult<Vec<MemberSnapshotRow>> {
    let mut statement = connection.prepare(
        "WITH ranked AS (
             SELECT id, capture_session_id, observed_at, avatar_id, avatar_name, official_name,
                    profession_name, profession_id, state,
                    is_online, role_id, legion_name, legion_id, legion_leader, prosperity,
                    weekly_contribution, weekly_merit, season_score, demolition_value, coordinate_x,
                    coordinate_y, last_offline_ts, join_ts, t_feat, t_forage_use, w_forage_use,
                    weekly_statistics_json, raw_json,
                    ROW_NUMBER() OVER (
                        PARTITION BY avatar_id
                        ORDER BY observed_at DESC, id DESC
                    ) AS rn
             FROM member_snapshot
             WHERE (?1 IS NULL OR workspace_id = ?1)
         )
         SELECT id, capture_session_id, observed_at, avatar_id, avatar_name, official_name,
                profession_name, profession_id, state,
                is_online, role_id, legion_name, legion_id, legion_leader, prosperity,
                weekly_contribution, weekly_merit, season_score, demolition_value, coordinate_x,
                coordinate_y, last_offline_ts, join_ts, t_feat, t_forage_use, w_forage_use,
                weekly_statistics_json,
                CASE WHEN ?2 THEN raw_json ELSE '{}' END AS raw_json
         FROM ranked
         WHERE rn = 1
         ORDER BY observed_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id, include_raw_json], map_member_snapshot_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_building_snapshots(
    connection: &Connection,
    workspace_id: Option<i64>,
    include_raw_json: bool,
) -> AppResult<Vec<BuildingSnapshotRow>> {
    let mut statement = connection.prepare(
        "SELECT id, capture_session_id, observed_at, building_name, facility_type, facility_type_id,
                role_facility_type, cfg_id, carrier_id, level, state, status_id, coordinate_x,
                coordinate_y, operator_avatar_id, operator_name, benefit, mine_count, max_mine_count,
                effect,
                CASE WHEN ?2 THEN raw_json ELSE '{}' END AS raw_json
         FROM building_snapshot
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY observed_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id, include_raw_json], |row| {
        Ok(BuildingSnapshotRow {
            id: row.get(0)?,
            capture_session_id: row.get(1)?,
            observed_at: row.get(2)?,
            building_name: row.get(3)?,
            facility_type: row.get(4)?,
            facility_type_id: row.get(5)?,
            role_facility_type: row.get(6)?,
            cfg_id: row.get(7)?,
            carrier_id: row.get(8)?,
            level: row.get(9)?,
            state: row.get(10)?,
            status_id: row.get(11)?,
            coordinate_x: row.get(12)?,
            coordinate_y: row.get(13)?,
            operator_avatar_id: row.get(14)?,
            operator_name: row.get(15)?,
            benefit: row.get(16)?,
            mine_count: row.get(17)?,
            max_mine_count: row.get(18)?,
            effect: row.get(19)?,
            raw_json: row.get(20)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_capture_sessions(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<CaptureSessionRow>> {
    let mut statement = connection.prepare(
        "SELECT id, capture_type, status, started_at, finished_at, summary_json
         FROM capture_session
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY started_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        // P1-5：summary_json 是 Option（空值不再序列化输出），与 TS 绑定
        // 的 `summaryJson?: string` 保持一致，避免前端拿到 undefined
        // 却被类型标注成必填 string。
        let summary_json: Option<String> = row.get(5)?;
        let capture_type: String = row.get(1)?;
        let status: String = row.get(2)?;
        let summary =
            decode_capture_session_summary(summary_json.as_deref().unwrap_or_default(), &capture_type, &status);
        Ok(CaptureSessionRow {
            id: row.get(0)?,
            capture_type,
            status,
            started_at: row.get(3)?,
            finished_at: row.get(4)?,
            summary_json,
            summary,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn decode_capture_session_summary(
    summary_json: &str,
    capture_type: &str,
    status: &str,
) -> Option<CaptureSessionSummaryRecord> {
    if let Ok(summary) = serde_json::from_str::<CaptureSessionSummaryRecord>(summary_json) {
        return Some(summary);
    }

    let parsed = serde_json::from_str::<Value>(summary_json).ok()?;
    let collector = parsed
        .get("collector")
        .and_then(Value::as_str)
        .unwrap_or("legacy")
        .to_string();
    let note = parsed
        .get("note")
        .and_then(Value::as_str)
        .unwrap_or(status)
        .to_string();
    let capture = parsed
        .get("capture")
        .and_then(|value| serde_json::from_value::<CaptureSessionCapture>(value.clone()).ok())
        .unwrap_or_else(|| {
            if collector == "seed" && capture_type.starts_with("seed_demo") {
                CaptureSessionCapture::Typed(Box::new(CollectorCapturePayload {
                    collector_mode: "seed".to_string(),
                    capture_type: capture_type.to_string(),
                    flow: "seeded".to_string(),
                    expected_artifacts: vec![],
                    navigation: vec![],
                    next_probe: None,
                    preview: None,
                    runtime: None,
                    evidence: None,
                }))
            } else {
                CaptureSessionCapture::Typed(Box::new(
                    CollectorCapturePayload::default_for_capture_type(capture_type),
                ))
            }
        });
    let sidecar_session_id = parsed
        .get("sidecarSessionId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let preview_insert_counts = parsed
        .get("previewInsertCounts")
        .and_then(|value| serde_json::from_value::<CapturePreviewCounts>(value.clone()).ok());
    let raw_artifact = parsed.get("rawArtifact").and_then(|value| {
        serde_json::from_value::<CaptureManifestArtifactSummary>(value.clone()).ok()
    });

    Some(CaptureSessionSummaryRecord {
        collector,
        status: status.to_string(),
        note,
        capture,
        sidecar_session_id,
        preview_insert_counts,
        raw_artifact,
    })
}

pub(super) fn query_raw_artifacts(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<RawArtifactRow>> {
    let mut statement = connection.prepare(
        "SELECT raw_artifact.id, raw_artifact.capture_session_id, raw_artifact.artifact_type,
                raw_artifact.path, raw_artifact.source_module, raw_artifact.source_func,
                raw_artifact.captured_at, raw_artifact.sha256, raw_artifact.sensitive_scan_status
         FROM raw_artifact
         JOIN capture_session ON capture_session.id = raw_artifact.capture_session_id
         WHERE (?1 IS NULL OR capture_session.workspace_id = ?1)
         ORDER BY raw_artifact.captured_at DESC, raw_artifact.id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        Ok(RawArtifactRow {
            id: row.get(0)?,
            capture_session_id: row.get(1)?,
            artifact_type: row.get(2)?,
            path: row.get(3)?,
            source_module: row.get(4)?,
            source_func: row.get(5)?,
            captured_at: row.get(6)?,
            sha256: row.get(7)?,
            sensitive_scan_status: row.get(8)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_export_jobs(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<ExportJobRow>> {
    let mut statement = connection.prepare(
        "SELECT id, created_at, job_kind, format, target, status, output_paths_json
         FROM export_job
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        let output_paths_json: String = row.get(6)?;
        let output_paths = serde_json::from_str::<Vec<String>>(&output_paths_json)
            .unwrap_or_else(|_| vec![output_paths_json.clone()]);
        Ok(ExportJobRow {
            id: row.get(0)?,
            created_at: row.get(1)?,
            job_kind: row.get(2)?,
            format: row.get(3)?,
            target: row.get(4)?,
            status: row.get(5)?,
            output_paths,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn ensure_export_job_workspace_id_column(connection: &Connection) -> AppResult<()> {
    let has_column: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM pragma_table_info('export_job')
            WHERE name = 'workspace_id'
        )",
        [],
        |row| row.get(0),
    )?;
    if !has_column {
        connection.execute("ALTER TABLE export_job ADD COLUMN workspace_id INTEGER", [])?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_export_job_workspace_created_at
             ON export_job(workspace_id, created_at, id DESC)",
            [],
        )?;
    }
    Ok(())
}

pub(super) fn ensure_battle_block_end_round_column(connection: &Connection) -> AppResult<()> {
    let has_column: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM pragma_table_info('battle_block')
            WHERE name = 'end_round'
        )",
        [],
        |row| row.get(0),
    )?;
    if !has_column {
        connection.execute(
            "ALTER TABLE battle_block ADD COLUMN end_round INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

pub(super) fn ensure_lineup_matchup_classification_columns(connection: &Connection) -> AppResult<()> {
    for (name, definition) in [
        ("match_type", "INTEGER NOT NULL DEFAULT 0"),
        ("combat_type", "INTEGER NOT NULL DEFAULT 0"),
        ("scenario_id", "INTEGER NOT NULL DEFAULT 0"),
        ("end_round", "INTEGER NOT NULL DEFAULT 0"),
        ("location", "TEXT NOT NULL DEFAULT ''"),
    ] {
        ensure_table_column(connection, "lineup_matchup", name, definition)?;
    }
    Ok(())
}

pub(super) fn ensure_alliance_standard_columns(connection: &Connection) -> AppResult<()> {
    let member_columns = [
        ("is_online", "INTEGER NOT NULL DEFAULT 0"),
        ("profession_name", "TEXT NOT NULL DEFAULT ''"),
        ("profession_id", "INTEGER NOT NULL DEFAULT 0"),
        ("role_id", "INTEGER NOT NULL DEFAULT 0"),
        ("legion_id", "INTEGER NOT NULL DEFAULT 0"),
        ("legion_leader", "INTEGER NOT NULL DEFAULT 0"),
        ("season_score", "INTEGER NOT NULL DEFAULT 0"),
        ("last_offline_ts", "INTEGER NOT NULL DEFAULT 0"),
        ("join_ts", "INTEGER NOT NULL DEFAULT 0"),
        ("t_feat", "INTEGER NOT NULL DEFAULT 0"),
        ("t_forage_use", "INTEGER NOT NULL DEFAULT 0"),
        ("w_forage_use", "INTEGER NOT NULL DEFAULT 0"),
        ("weekly_statistics_json", "TEXT NOT NULL DEFAULT '{}'"),
    ];
    for (name, definition) in member_columns {
        ensure_table_column(connection, "member_snapshot", name, definition)?;
    }

    let log_columns = [("log_section", "TEXT NOT NULL DEFAULT 'other'")];
    for (name, definition) in log_columns {
        ensure_table_column(connection, "union_log_event", name, definition)?;
    }
    backfill_union_log_events(connection)?;

    let building_columns = [
        ("facility_type", "TEXT NOT NULL DEFAULT ''"),
        ("facility_type_id", "INTEGER NOT NULL DEFAULT 0"),
        ("role_facility_type", "INTEGER NOT NULL DEFAULT 0"),
        ("cfg_id", "INTEGER NOT NULL DEFAULT 0"),
        ("carrier_id", "TEXT NOT NULL DEFAULT ''"),
        ("status_id", "INTEGER NOT NULL DEFAULT 0"),
        ("coordinate_x", "INTEGER NOT NULL DEFAULT 0"),
        ("coordinate_y", "INTEGER NOT NULL DEFAULT 0"),
        ("operator_avatar_id", "TEXT NOT NULL DEFAULT ''"),
        ("operator_name", "TEXT NOT NULL DEFAULT ''"),
        ("benefit", "INTEGER NOT NULL DEFAULT 0"),
        ("mine_count", "INTEGER NOT NULL DEFAULT 0"),
        ("max_mine_count", "INTEGER NOT NULL DEFAULT 0"),
    ];
    for (name, definition) in building_columns {
        ensure_table_column(connection, "building_snapshot", name, definition)?;
    }
    Ok(())
}

#[derive(Debug)]
struct UnionLogBackfillRow {
    id: i64,
    category: String,
    section: String,
    text: String,
    raw_event_json: String,
}

pub(super) fn backfill_union_log_events(connection: &Connection) -> AppResult<()> {
    let rows = {
        let mut statement = connection.prepare(
            "SELECT id, log_category, COALESCE(log_section, ''), text, raw_event_json
             FROM union_log_event
             WHERE log_section IS NULL OR log_section = ''",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(UnionLogBackfillRow {
                id: row.get(0)?,
                category: row.get(1)?,
                section: row.get(2)?,
                text: row.get(3)?,
                raw_event_json: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for row in rows {
        let raw = serde_json::from_str::<Value>(&row.raw_event_json).ok();
        let section = infer_union_log_section(&row.category, raw.as_ref(), &row.text);
        let text = format_union_log_text(&row.category, raw.as_ref(), &row.text);
        if section != row.section || text != row.text {
            connection.execute(
                "UPDATE union_log_event SET log_section = ?1, text = ?2 WHERE id = ?3",
                params![section, text, row.id],
            )?;
        }
    }
    Ok(())
}

pub(super) fn infer_union_log_section(category: &str, raw: Option<&Value>, text: &str) -> String {
    let mail = union_log_mail_no(category);
    if category.starts_with("personnel:")
        || text_contains_any(text, &["加入了同盟", "加入同盟", "离开同盟"])
    {
        return "personnel".to_string();
    }

    if let Some(args) = raw.and_then(union_log_text_args) {
        if args.keys().any(|key| {
            let key = key.to_lowercase();
            key.contains("talent")
                || key.contains("skill")
                || key.contains("profession")
                || key.contains("career")
        }) {
            return "profession".to_string();
        }
        if args.contains_key("strategy_name") {
            return "management".to_string();
        }
        if args.contains_key("avatarList") {
            return "siege".to_string();
        }
        if args.contains_key("city_name") && args.contains_key("state_name") {
            return "city".to_string();
        }
    }

    if text_contains_any(text, &["军屯", "耕作", "铸币", "开疆", "增产"]) {
        return "profession".to_string();
    }

    match mail {
        "1001336" => return "personnel".to_string(),
        "1000007" | "1000008" | "1000010" | "1000031" | "1000310" | "1000418" | "1090212"
        | "1090213" => return "siege".to_string(),
        "1000242" | "1000291" | "1000316" | "1000437" | "1001172" | "1001173" => {
            return "management".to_string()
        }
        "1000019" | "1000254" | "1000255" | "1000261" | "1000272" | "1000292" | "1000449"
        | "1000450" | "1001171" => return "city".to_string(),
        _ => {}
    }

    if text_contains_any(text, &["宣战", "攻占", "最后一击", "攻城"]) {
        return "siege".to_string();
    }
    if text_contains_any(text, &["迁城", "城池", "归属"]) {
        return "city".to_string();
    }
    if text_contains_any(text, &["策略", "等级", "建筑", "管理"]) {
        return "management".to_string();
    }
    "management".to_string()
}

pub(super) fn format_union_log_text(category: &str, raw: Option<&Value>, current_text: &str) -> String {
    let Some(args) = raw.and_then(union_log_text_args) else {
        return clean_game_markup(current_text);
    };
    let mail = union_log_mail_no(category);
    let player = arg_clean(args, &["player_name", "playerName"]).unwrap_or_default();
    let city = arg_clean(args, &["city_name", "cityName"]).unwrap_or_default();
    let coord = arg_clean(args, &["coord"]).unwrap_or_default();

    match mail {
        "1000007" => format!(
            "{}对{}{}宣战",
            nonempty_or(&player, "同盟成员"),
            nonempty_or(&city, "目标城池"),
            coord
        ),
        "1000008" => format!(
            "{}取消了对{}{}的宣战",
            nonempty_or(&player, "同盟成员"),
            nonempty_or(&city, "目标城池"),
            coord
        ),
        "1090212" | "1090213" => {
            let city_x = arg_clean(args, &["cityX", "city_x"]).unwrap_or_default();
            let city_y = arg_clean(args, &["cityY", "city_y"]).unwrap_or_default();
            let city_coord = if !city_x.is_empty() && !city_y.is_empty() {
                format!("({city_x},{city_y})")
            } else {
                coord
            };
            let hitter = arg_clean(args, &["killsRank1_name", "killRank1_name", "HPRank1_name"])
                .unwrap_or_else(|| "未知".to_string());
            let duration = arg_clean(args, &["costTimeStr"]).unwrap_or_default();
            let suffix = if duration.is_empty() {
                String::new()
            } else {
                format!("，用时{duration}")
            };
            format!(
                "我方攻占了{}{}城池，同盟成员{}完成了最后一击{}",
                nonempty_or(&city, "城池"),
                city_coord,
                hitter,
                suffix
            )
        }
        "1000010" | "1000418" => format_bandit_log(args),
        "1000031" => {
            let members =
                arg_clean(args, &["avatarList"]).unwrap_or_else(|| "同盟成员".to_string());
            let contribution = arg_clean(args, &["contribution"]).unwrap_or_default();
            if contribution.is_empty() {
                format!("{members}完成攻城协作")
            } else {
                format!("{members}完成攻城协作，获得贡献{contribution}")
            }
        }
        "1000310" => {
            arg_clean(args, &["info"]).unwrap_or_else(|| "城池附近叛军大营已清剿".to_string())
        }
        "1000291" => {
            let name =
                arg_clean(args, &["strategy_name"]).unwrap_or_else(|| "同盟策略".to_string());
            let desc = arg_clean(args, &["strategy_des"]).unwrap_or_default();
            if desc.is_empty() {
                format!("同盟发动了{name}")
            } else {
                format!("同盟发动了{name}：{desc}")
            }
        }
        "1000242" => match arg_clean(args, &["rank"]) {
            Some(rank) if !rank.is_empty() => format!("同盟排行变化至第{rank}名"),
            _ => "同盟排行发生变化".to_string(),
        },
        "1000316" => match arg_clean(args, &["level"]) {
            Some(level) if !level.is_empty() => format!("同盟等级提升至{level}级"),
            _ => "同盟等级发生变化".to_string(),
        },
        "1000437" => match arg_clean(args, &["team_name"]) {
            Some(team_name) if !team_name.is_empty() => {
                format!("同盟队伍配置发生变化：{team_name}")
            }
            _ => "同盟队伍配置发生变化".to_string(),
        },
        "1001172" => {
            let target_city = arg_clean(args, &["target_city_name"]).unwrap_or_default();
            if target_city.is_empty() {
                format!("同盟管理了{}{}", nonempty_or(&city, "城池"), coord)
            } else {
                format!(
                    "同盟管理了{}{}，关联目标{}",
                    nonempty_or(&city, "城池"),
                    coord,
                    target_city
                )
            }
        }
        "1001173" => format!("同盟建筑事件发生在{}", nonempty_or(&coord, "未知坐标")),
        "1000019" => {
            let start_name = arg_clean(args, &["startName"]).unwrap_or_default();
            let start_coord = arg_clean(args, &["startCrood", "startCoord"]).unwrap_or_default();
            let end_name = arg_clean(args, &["endName"]).unwrap_or_default();
            let end_coord = arg_clean(args, &["endCrood", "endCoord"]).unwrap_or_default();
            format!(
                "{}从{}{}迁往{}{}",
                nonempty_or(&player, "同盟成员"),
                start_name,
                start_coord,
                end_name,
                end_coord
            )
        }
        "1000254" | "1000255" => {
            let level = arg_clean(args, &["city_level"]).unwrap_or_default();
            let seat = arg_clean(args, &["addition_seat"]).unwrap_or_default();
            format!(
                "{}{}级城池获得{}加成",
                nonempty_or(&city, "城池"),
                level,
                seat
            )
        }
        "1000261" => {
            let food = arg_clean(args, &["food"]).unwrap_or_default();
            let percent = arg_clean(args, &["percent"]).unwrap_or_default();
            if food.is_empty() {
                format!("城池资源储备达到{percent}%")
            } else {
                format!("城池资源储备达到{percent}%，粮草{food}")
            }
        }
        "1000272" => format!("城池坐标事件发生在{}", nonempty_or(&coord, "未知坐标")),
        "1000292" => match arg_clean(args, &["info"]) {
            Some(info) if !info.is_empty() => format!("城池相关信息：{info}"),
            _ => "城池相关信息发生变化".to_string(),
        },
        "1000449" | "1000450" => {
            let state = arg_clean(args, &["state_name"]).unwrap_or_else(|| "州郡".to_string());
            format!("{}归属{}", nonempty_or(&city, "城池"), state)
        }
        "1001171" => {
            let names = city_names_from_args(args);
            if names.is_empty() {
                "同盟城池连线发生变化".to_string()
            } else {
                format!("同盟城池连线发生变化：{}", names.join("、"))
            }
        }
        "1001336" => {
            let union_name = arg_clean(args, &["unionName", "union_name"]).unwrap_or_default();
            format!("{}发生人员/外交变动", nonempty_or(&union_name, "同盟"))
        }
        _ => clean_game_markup(current_text),
    }
}

pub(super) fn union_log_mail_no(category: &str) -> &str {
    category.rsplit(':').next().unwrap_or(category)
}

pub(super) fn union_log_text_args(raw: &Value) -> Option<&serde_json::Map<String, Value>> {
    raw.get("raw")
        .and_then(|value| value.get("textArgs"))
        .and_then(Value::as_object)
        .or_else(|| raw.get("textArgs").and_then(Value::as_object))
}

pub(super) fn arg_clean(args: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = args.get(*key) else {
            continue;
        };
        let text = match value {
            Value::String(value) => value.clone(),
            Value::Number(value) => value.to_string(),
            Value::Bool(value) => value.to_string(),
            _ => continue,
        };
        let cleaned = clean_game_markup(&text);
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    None
}

pub(super) fn clean_game_markup(value: &str) -> String {
    let value = value
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("<br />", " ");
    let mut output = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            '【' | '】' if !in_tag => {}
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn nonempty_or<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

pub(super) fn format_bandit_log(args: &serde_json::Map<String, Value>) -> String {
    let bandit_name = arg_clean(args, &["banditName"]).unwrap_or_else(|| "叛军".to_string());
    let player_count = arg_clean(args, &["bandit_player_number"]).unwrap_or_default();
    let exp = arg_clean(args, &["exp"]).unwrap_or_default();
    let leader = arg_clean(args, &["rankDesc"])
        .and_then(|text| {
            text.split(" 灭敌")
                .next()
                .map(str::trim)
                .map(ToString::to_string)
        })
        .filter(|text| !text.is_empty())
        .unwrap_or_default();
    let mut parts = vec![format!("讨伐{bandit_name}完成")];
    if !player_count.is_empty() {
        parts.push(format!("参与{player_count}队"));
    }
    if !exp.is_empty() {
        parts.push(format!("经验{exp}"));
    }
    if !leader.is_empty() {
        parts.push(format!("战功领先：{leader}"));
    }
    parts.join("，")
}

pub(super) fn city_names_from_args(args: &serde_json::Map<String, Value>) -> Vec<String> {
    let mut names = args
        .iter()
        .filter_map(|(key, value)| {
            if !key.starts_with("city_name") {
                return None;
            }
            let order = key
                .rsplit('_')
                .next()
                .and_then(|part| part.parse::<i64>().ok())
                .unwrap_or(0);
            let text = match value {
                Value::String(value) => clean_game_markup(value),
                _ => clean_game_markup(&value.to_string()),
            };
            if text.is_empty() {
                None
            } else {
                Some((order, text))
            }
        })
        .collect::<Vec<_>>();
    names.sort_by_key(|(order, _)| *order);
    let mut deduped = Vec::new();
    for (_, name) in names {
        if !deduped.contains(&name) {
            deduped.push(name);
        }
        if deduped.len() >= 8 {
            break;
        }
    }
    deduped
}

pub(super) fn text_contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

pub(super) fn ensure_table_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> AppResult<()> {
    let query = format!(
        "SELECT EXISTS(
            SELECT 1
            FROM pragma_table_info('{}')
            WHERE name = ?1
        )",
        table_name.replace('\'', "''")
    );
    let has_column: bool = connection.query_row(&query, params![column_name], |row| row.get(0))?;
    if !has_column {
        connection.execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
            [],
        )?;
    }
    Ok(())
}

pub(super) fn query_battle_reports(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<BattleReportRow>> {
    let mut statement = connection.prepare(
        "SELECT workspace_id, alliance_id, battle_id, battle_code, occurred_at, location, match_type, result, winner_side,
                attacker_json, defender_json, battlefield_environment_json, end_round
         FROM battle_block
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY occurred_at DESC, id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], map_battle_report_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_battle_report_by_code(
    connection: &Connection,
    battle_code: &str,
    workspace_id: Option<i64>,
) -> AppResult<Option<BattleReportRow>> {
    let mut statement = connection.prepare(
        "SELECT workspace_id, alliance_id, battle_id, battle_code, occurred_at, location, match_type, result, winner_side,
                attacker_json, defender_json, battlefield_environment_json, end_round
         FROM battle_block
         WHERE battle_code = ?1
           AND (?2 IS NULL OR workspace_id = ?2)
         ORDER BY record_index DESC, id DESC
         LIMIT 1",
    )?;
    let mut rows = statement.query(params![battle_code, workspace_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_battle_report_row(row)?))
    } else {
        Ok(None)
    }
}

pub(super) fn query_lineup_profiles_for_battle_code(
    connection: &Connection,
    battle_code: &str,
    workspace_id: Option<i64>,
) -> AppResult<Vec<LineupProfileRow>> {
    let mut statement = connection.prepare(
        "SELECT lineup_profile.player_id, lineup_profile.alliance_id, lineup_profile.label, player.display_name, lineup_profile.heroes_json,
                lineup_profile.source_battle_id, lineup_profile.confidence
         FROM lineup_profile
         LEFT JOIN player ON player.id = lineup_profile.player_id
         WHERE lineup_profile.source_battle_id = ?1
           AND (?2 IS NULL OR lineup_profile.workspace_id = ?2)
         ORDER BY lineup_profile.updated_at DESC, lineup_profile.id DESC",
    )?;
    let rows = statement.query_map(params![battle_code, workspace_id], |row| {
        let heroes_json: String = row.get(4)?;
        let player = row
            .get::<_, Option<String>>(3)?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未知玩家".to_string());
        let source_battle_id = row
            .get::<_, Option<String>>(5)?
            .filter(|value| !value.trim().is_empty());
        let heroes = serde_json::from_str::<Value>(&heroes_json)
            .ok()
            .and_then(|value| {
                value.as_array().map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
            })
            .unwrap_or_else(|| heroes_json.clone());
        Ok(LineupProfileRow {
            player_id: row.get(0)?,
            alliance_id: row.get(1)?,
            label: row.get(2)?,
            player,
            heroes,
            source: source_battle_id
                .map(|battle_code| format!("战报 {battle_code}"))
                .unwrap_or_else(|| "手动固定".to_string()),
            confidence: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_lineup_profiles(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<LineupProfileRow>> {
    let mut statement = connection.prepare(
        "SELECT lineup_profile.player_id, lineup_profile.alliance_id, lineup_profile.label, player.display_name, lineup_profile.heroes_json,
                lineup_profile.source_battle_id, lineup_profile.confidence
         FROM lineup_profile
         LEFT JOIN player ON player.id = lineup_profile.player_id
         WHERE (?1 IS NULL OR lineup_profile.workspace_id = ?1)
         ORDER BY lineup_profile.updated_at DESC, lineup_profile.id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        let heroes_json: String = row.get(4)?;
        let player = row
            .get::<_, Option<String>>(3)?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未知玩家".to_string());
        let source_battle_id = row
            .get::<_, Option<String>>(5)?
            .filter(|value| !value.trim().is_empty());
        let heroes = serde_json::from_str::<Value>(&heroes_json)
            .ok()
            .and_then(|value| {
                value.as_array().map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
            })
            .unwrap_or_else(|| heroes_json.clone());
        Ok(LineupProfileRow {
            player_id: row.get(0)?,
            alliance_id: row.get(1)?,
            label: row.get(2)?,
            player,
            heroes,
            source: source_battle_id
                .map(|battle_code| format!("战报 {battle_code}"))
                .unwrap_or_else(|| "手动固定".to_string()),
            confidence: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_lineup_stats(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<LineupStatRow>> {
    let mut statement = connection.prepare(
        "SELECT id, workspace_id, avatar_id, player_name, alliance_name,
                lineup_key, label, formation_id, formation_name,
                hero_ids_json, hero_levels_json, avg_evolution,
                battles, wins, losses, draws,
                attack_battles, defend_battles,
                total_merit, total_origin_troops, total_remaining_troops,
                total_wounded, total_dead,
                total_enemy_origin_troops, total_enemy_remaining_troops,
                total_enemy_wounded, total_enemy_dead,
                loss_exchange_ratio, last_battle_time, notes, observed_at
         FROM lineup_stat
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY battles DESC, last_battle_time DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        Ok(LineupStatRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            avatar_id: row.get(2)?,
            player_name: row.get(3)?,
            alliance_name: row.get(4)?,
            lineup_key: row.get(5)?,
            label: row.get(6)?,
            formation_id: row.get(7)?,
            formation_name: row.get(8)?,
            hero_ids_json: row.get(9)?,
            hero_levels_json: row.get(10)?,
            avg_evolution: row.get(11)?,
            battles: row.get(12)?,
            wins: row.get(13)?,
            losses: row.get(14)?,
            draws: row.get(15)?,
            attack_battles: row.get(16)?,
            defend_battles: row.get(17)?,
            total_merit: row.get(18)?,
            total_origin_troops: row.get(19)?,
            total_remaining_troops: row.get(20)?,
            total_wounded: row.get(21)?,
            total_dead: row.get(22)?,
            total_enemy_origin_troops: row.get(23)?,
            total_enemy_remaining_troops: row.get(24)?,
            total_enemy_wounded: row.get(25)?,
            total_enemy_dead: row.get(26)?,
            loss_exchange_ratio: row.get(27)?,
            last_battle_time: row.get(28)?,
            notes: row.get(29)?,
            observed_at: row.get(30)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_lineup_matchups(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<LineupMatchupRow>> {
    let mut statement = connection.prepare(
        "SELECT id, workspace_id,
                attacker_avatar_id, attacker_player_name,
                attacker_lineup_key, attacker_lineup_label,
                defender_avatar_id, defender_player_name,
                defender_lineup_key, defender_lineup_label,
                outcome, battle_time, battle_code, observed_at,
                match_type, combat_type, scenario_id, end_round, location
         FROM lineup_matchup
         WHERE (?1 IS NULL OR workspace_id = ?1)
         ORDER BY battle_time DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        Ok(LineupMatchupRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            attacker_avatar_id: row.get(2)?,
            attacker_player_name: row.get(3)?,
            attacker_lineup_key: row.get(4)?,
            attacker_lineup_label: row.get(5)?,
            defender_avatar_id: row.get(6)?,
            defender_player_name: row.get(7)?,
            defender_lineup_key: row.get(8)?,
            defender_lineup_label: row.get(9)?,
            outcome: row.get(10)?,
            battle_time: row.get(11)?,
            battle_code: row.get(12)?,
            observed_at: row.get(13)?,
            match_type: row.get(14)?,
            combat_type: row.get(15)?,
            scenario_id: row.get(16)?,
            end_round: row.get(17)?,
            location: row.get(18)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn query_member_bindings(
    connection: &Connection,
    workspace_id: Option<i64>,
) -> AppResult<Vec<MemberBindingRow>> {
    let mut statement = connection.prepare(
        "SELECT player_id, alliance_id, avatar_name, avatar_id,
                alliance.name, confidence, valid_from,
                valid_to IS NULL AS is_active
         FROM (
             SELECT alliance_member_binding.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY alliance_member_binding.avatar_id
                        ORDER BY alliance_member_binding.valid_from DESC,
                                 alliance_member_binding.id DESC
                    ) AS rn
             FROM alliance_member_binding
             WHERE (?1 IS NULL OR alliance_member_binding.workspace_id = ?1)
         ) alliance_member_binding
         JOIN alliance ON alliance.id = alliance_member_binding.alliance_id
         WHERE alliance_member_binding.rn = 1
         ORDER BY alliance_member_binding.valid_from DESC, alliance_member_binding.id DESC",
    )?;
    let rows = statement.query_map(params![workspace_id], |row| {
        let updated: String = row.get(6)?;
        let is_active: bool = row.get(7)?;
        Ok(MemberBindingRow {
            player_id: row.get(0)?,
            alliance_id: row.get(1)?,
            name: row.get(2)?,
            avatar: row.get(3)?,
            alliance: row.get(4)?,
            status: row.get(5)?,
            updated,
            is_active,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub(super) fn weekly_stat_number(stats: Option<&Value>, key: &str) -> i64 {
    let value = stats.and_then(|stats| stats.get(key));
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_u64().map(|value| value as i64))
            .unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

pub(super) fn format_join_time(join_ts: i64) -> String {
    if join_ts <= 0 {
        return "-".to_string();
    }
    Local
        .timestamp_opt(join_ts, 0)
        .single()
        .map(|dt| dt.format("%Y.%m.%d %H:%M:%S").to_string())
        .unwrap_or_else(|| join_ts.to_string())
}

#[cfg(test)]
pub(super) fn count_table(connection: &Connection, table: &str) -> AppResult<i64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .map_err(AppError::from)
}

pub(super) fn resolve_alliance_context(
    connection: &Connection,
    workspace_id: i64,
    alliance_id: Option<i64>,
) -> AppResult<(i64, String)> {
    if let Some(alliance_id) = alliance_id {
        let alliance_name = connection.query_row(
            "SELECT name
             FROM alliance
             WHERE id = ?1 AND workspace_id = ?2",
            params![alliance_id, workspace_id],
            |row| row.get(0),
        )?;
        return Ok((alliance_id, alliance_name));
    }

    connection
        .query_row(
            "SELECT id, name
             FROM alliance
             WHERE workspace_id = ?1
             ORDER BY updated_at DESC, id DESC
             LIMIT 1",
            params![workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(AppError::from)
}

pub(super) fn upsert_player(
    connection: &Connection,
    avatar_id: Option<&str>,
    display_name: &str,
    now: &str,
) -> AppResult<i64> {
    if let Some(avatar_id) = avatar_id.filter(|value| !value.trim().is_empty()) {
        if let Some(player_id) = connection
            .query_row(
                "SELECT id
                 FROM player
                 WHERE avatar_id = ?1",
                params![avatar_id],
                |row| row.get(0),
            )
            .optional()?
        {
            connection.execute(
                "UPDATE player
                 SET display_name = ?1,
                     updated_at = ?2
                 WHERE id = ?3",
                params![display_name, now, player_id],
            )?;
            return Ok(player_id);
        }

        connection.execute(
            "INSERT INTO player (avatar_id, display_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![avatar_id, display_name, now],
        )?;
        return Ok(connection.last_insert_rowid());
    }

    if let Some(player_id) = connection
        .query_row(
            "SELECT id
             FROM player
             WHERE avatar_id IS NULL AND display_name = ?1",
            params![display_name],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(player_id);
    }

    connection.execute(
        "INSERT INTO player (avatar_id, display_name, created_at, updated_at)
         VALUES (NULL, ?1, ?2, ?2)",
        params![display_name, now],
    )?;
    Ok(connection.last_insert_rowid())
}
