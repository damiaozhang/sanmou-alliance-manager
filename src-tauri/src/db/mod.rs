mod capture;
mod export;
mod helpers;
mod lineup;
mod query;

use crate::error::{AppError, AppResult};
use crate::models::{
    AppBundle, BackupResult, ComparisonStats, CreateWorkspaceRequest, CreateWorkspaceResponse,
    ExportDirectoryInfo, InternalFullAppBundle, LineupProfileRow, MemberBindingRow, RestoreResult,
    SaveLineupProfileRequest, SaveMemberBindingRequest, WorkspaceRecord, WorkspaceSummary,
};
#[cfg(test)]
use crate::models::{CaptureSessionCapture, CaptureSessionSummaryRecord, CollectorCapturePayload};
#[cfg(test)]
use self::query::count_table;
use chrono::{Local, NaiveDate, TimeZone};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use self::helpers::{backup_path_for, copy_dir_recursive, remove_entry, write_text_if_changed};
use self::query::{
    ensure_alliance_standard_columns,
    ensure_battle_block_end_round_column, ensure_export_job_workspace_id_column,
    ensure_lineup_matchup_classification_columns, query_alliance_facilities, query_alliance_groups,
    query_alliance_logs, query_alliance_members, query_battle_reports, query_building_snapshots,
    query_capture_sessions, query_export_jobs, query_lineup_profiles, query_member_bindings,
    query_member_snapshots, query_raw_artifacts, resolve_alliance_context, upsert_player,
};

const INITIAL_MIGRATION: &str = include_str!("../../migrations/001_initial.sql");

const INDEX_MIGRATION: &str = include_str!("../../migrations/002_indexes.sql");

const LINEUP_STATS_MIGRATION: &str = include_str!("../../migrations/003_lineup_stats.sql");

const PERFORMANCE_INDEXES_MIGRATION: &str =
    include_str!("../../migrations/004_performance_indexes.sql");

const LINEUP_MATCHUP_TIME_INDEX_MIGRATION: &str =
    include_str!("../../migrations/006_indexes.sql");

/// 007：同盟情报（新增采集域）通用存储，见迁移文件头部说明。
const ALLIANCE_INTEL_MIGRATION: &str = include_str!("../../migrations/007_alliance_intel.sql");

const APP_SETTING_EXPORT_ROOT_KEY: &str = "export_root";
/// P2 修复：一次性数据清理的标记键。此前每次启动都会无条件执行
/// `DELETE FROM lineup_matchup ...`，而在 `delete_capture_session` 级联清掉
/// battle_block 之后，该条件会命中**历史**配对行并被静默删除。改为按标记
/// 只跑一次。
const APP_SETTING_LEGACY_MATCHUP_CLEANUP_KEY: &str = "legacy_matchup_cleanup_done";

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
    app_data_dir: PathBuf,
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database")
            .field("app_data_dir", &self.app_data_dir)
            .finish()
    }
}

fn save_member_binding_tx(
    transaction: &Transaction<'_>,
    request: &SaveMemberBindingRequest,
    now: &str,
) -> AppResult<MemberBindingRow> {
    let SaveMemberBindingRequest {
        workspace_id,
        alliance_id,
        avatar_id,
        avatar_name,
        confidence,
    } = request;

    if avatar_id.trim().is_empty() {
        return Err(AppError::Message("avatar_id 不能为空".to_string()));
    }
    if avatar_name.trim().is_empty() {
        return Err(AppError::Message("avatar_name 不能为空".to_string()));
    }

    let (resolved_alliance_id, alliance_name) =
        resolve_alliance_context(transaction, *workspace_id, *alliance_id)?;

    // Idempotency: the frontend auto-binding flow calls this on every sync.
    // If an open binding for the same (workspace, alliance, avatar) already
    // exists with the same name, return it unchanged instead of closing it
    // and inserting a duplicate history row.
    let existing = transaction
        .query_row(
            "SELECT player_id, avatar_name, valid_from, confidence
             FROM alliance_member_binding
             WHERE workspace_id = ?1
               AND alliance_id = ?2
               AND avatar_id = ?3
               AND valid_to IS NULL
             ORDER BY id DESC
             LIMIT 1",
            params![workspace_id, resolved_alliance_id, avatar_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    if let Some((existing_player_id, existing_name, existing_valid_from, existing_confidence)) =
        existing
    {
        if existing_name == *avatar_name {
            return Ok(MemberBindingRow {
                player_id: Some(existing_player_id),
                alliance_id: Some(resolved_alliance_id),
                name: existing_name,
                avatar: avatar_id.clone(),
                alliance: alliance_name,
                status: existing_confidence,
                updated: existing_valid_from,
                is_active: true,
            });
        }
    }

    let player_id = upsert_player(transaction, Some(avatar_id.as_str()), avatar_name, now)?;

    transaction.execute(
        "UPDATE alliance_member_binding
         SET valid_to = ?1
         WHERE workspace_id = ?2
           AND alliance_id = ?3
           AND avatar_id = ?4
           AND valid_to IS NULL",
        params![
            now,
            workspace_id,
            resolved_alliance_id,
            avatar_id.as_str()
        ],
    )?;

    transaction.execute(
        "INSERT INTO alliance_member_binding
          (workspace_id, alliance_id, player_id, avatar_id, avatar_name, valid_from, valid_to, confidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
        params![
            workspace_id,
            resolved_alliance_id,
            player_id,
            avatar_id.as_str(),
            avatar_name.as_str(),
            now,
            confidence.as_str(),
        ],
    )?;

    Ok(MemberBindingRow {
        player_id: Some(player_id),
        alliance_id: Some(resolved_alliance_id),
        name: avatar_name.clone(),
        avatar: avatar_id.clone(),
        alliance: alliance_name,
        status: confidence.clone(),
        updated: now.to_string(),
        is_active: true,
    })
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&app_data_dir)?;
        let path = app_data_dir.join("sanmou-alliance-manager.db");
        let connection = Connection::open(&path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "cache_size", "-64000")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        connection.pragma_update(None, "wal_autocheckpoint", 500)?;
        // 锁竞争时的重试等待窗口（毫秒）：避免采集/导出等长事务与前台查询并发时
        // 直接报 SQLITE_BUSY，导致整个 IPC 调用失败或 UI 假死。
        connection.pragma_update(None, "busy_timeout", 5000)?;
        let database = Self {
            connection: Arc::new(Mutex::new(connection)),
            app_data_dir,
        };
        database.initialize()?;
        // Persist the effective export root for external readers (e.g. the
        // battle_grabber bridge) without mutating process env, which is not
        // thread-safe once worker threads exist.
        database.persist_export_root_file()?;
        #[cfg(test)]
        database.seed_demo_data_if_empty()?;
        Ok(database)
    }

    pub(super) fn export_root(&self) -> PathBuf {
        if let Ok(value) = std::env::var("SMDC_EXPORT_ROOT") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }

        self.setting_export_root()
            .unwrap_or_else(|_| self.default_export_root())
    }

    fn default_export_root(&self) -> PathBuf {
        self.app_data_dir.join("exports")
    }

    fn setting_export_root(&self) -> AppResult<PathBuf> {
        let connection = self.conn();
        let value = connection
            .query_row(
                "SELECT value FROM app_setting WHERE key = ?1",
                params![APP_SETTING_EXPORT_ROOT_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(value) = value {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
        Ok(self.app_data_dir.join("exports"))
    }

    fn export_root_file_path(&self) -> PathBuf {
        self.app_data_dir.join("export_root.txt")
    }

    fn persist_export_root_file(&self) -> AppResult<()> {
        let root = self.export_root();
        write_text_if_changed(
            &self.export_root_file_path(),
            root.to_string_lossy().as_ref(),
        )
    }

    pub fn export_directory_info(&self) -> AppResult<ExportDirectoryInfo> {
        let path = self.export_root();
        Ok(ExportDirectoryInfo {
            path: path.to_string_lossy().to_string(),
            is_custom: path != self.default_export_root(),
        })
    }

    pub fn set_export_directory(&self, path: &Path) -> AppResult<ExportDirectoryInfo> {
        // P1-4 修复：拒绝空路径、文件系统根目录与系统敏感目录，避免导出数据
        // （含成员名/坐标等敏感信息）被写入不可预期位置。
        Self::validate_export_directory(path)?;
        let normalized = path.to_path_buf();
        fs::create_dir_all(&normalized)?;
        let now = Local::now().to_rfc3339();
        let connection = self.conn();
        connection.execute(
            "INSERT INTO app_setting (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![
                APP_SETTING_EXPORT_ROOT_KEY,
                normalized.to_string_lossy().to_string(),
                now,
            ],
        )?;
        drop(connection);
        self.persist_export_root_file()?;
        Ok(ExportDirectoryInfo {
            path: normalized.to_string_lossy().to_string(),
            is_custom: true,
        })
    }

    pub fn reset_export_directory(&self) -> AppResult<ExportDirectoryInfo> {
        let connection = self.conn();
        connection.execute(
            "DELETE FROM app_setting WHERE key = ?1",
            params![APP_SETTING_EXPORT_ROOT_KEY],
        )?;
        drop(connection);
        self.persist_export_root_file()?;
        let path = self.default_export_root();
        Ok(ExportDirectoryInfo {
            path: path.to_string_lossy().to_string(),
            is_custom: false,
        })
    }

    /// P1-4：导出目录路径校验——拒绝空路径、文件系统根目录与系统敏感目录。
    fn validate_export_directory(path: &Path) -> AppResult<()> {
        let text = path.to_string_lossy();
        if text.trim().is_empty() {
            return Err(AppError::Message("导出目录不能为空".to_string()));
        }
        // 拒绝驱动器根目录（如 C:\ / D:\）
        if path.parent().is_none() {
            return Err(AppError::Message(format!(
                "导出目录不能是文件系统根目录：{text}"
            )));
        }
        // 拒绝常见系统敏感目录
        let lower = text.to_ascii_lowercase().replace('\\', "/");
        let normalized = lower.trim_end_matches('/');
        let sensitive: [&str; 8] = [
            "c:/windows",
            "c:/program files",
            "c:/program files (x86)",
            "c:/programdata",
            "c:/users/default",
            "c:/system volume information",
            "c:/$recycle.bin",
            "c:/users/public",
        ];
        for prefix in sensitive {
            if normalized == prefix || normalized.starts_with(&format!("{prefix}/")) {
                return Err(AppError::Message(format!(
                    "导出目录不允许设置为系统敏感目录：{text}"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn conn(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.connection.lock()
    }

    fn initialize(&self) -> AppResult<()> {
        let conn = self.conn();
        conn.execute_batch(INITIAL_MIGRATION)?;
        conn.execute_batch(INDEX_MIGRATION)?;
        conn.execute_batch(LINEUP_STATS_MIGRATION)?;
        conn.execute_batch(PERFORMANCE_INDEXES_MIGRATION)?;
        conn.execute_batch(LINEUP_MATCHUP_TIME_INDEX_MIGRATION)?;
        conn.execute_batch(ALLIANCE_INTEL_MIGRATION)?;
        ensure_export_job_workspace_id_column(&conn)?;
        ensure_alliance_standard_columns(&conn)?;
        ensure_battle_block_end_round_column(&conn)?;
        ensure_lineup_matchup_classification_columns(&conn)?;
        // One-time cleanup of legacy aggregated matchup rows (empty player names
        // with battle codes that never existed as real battle blocks). Real
        // per-battle rows always carry attacker/defender names, so they are not
        // affected even when battle_block is empty.
        // P2 修复：用 app_setting 标记只执行一次——否则在 battle_block 被级联
        // 清空后，这条 DELETE 会把历史配对行也一并静默删掉。
        Self::run_legacy_matchup_cleanup_once(&conn)?;
        Ok(())
    }

    fn run_legacy_matchup_cleanup_once(conn: &Connection) -> AppResult<()> {
        let done = conn
            .query_row(
                "SELECT value FROM app_setting WHERE key = ?1",
                params![APP_SETTING_LEGACY_MATCHUP_CLEANUP_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some();
        if done {
            return Ok(());
        }
        conn.execute(
            "DELETE FROM lineup_matchup
             WHERE attacker_player_name = ''
               AND defender_player_name = ''
               AND battle_code NOT IN (SELECT battle_code FROM battle_block)",
            [],
        )?;
        conn.execute(
            "INSERT INTO app_setting (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![
                APP_SETTING_LEGACY_MATCHUP_CLEANUP_KEY,
                "1",
                Local::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    #[cfg(test)]
    fn seed_demo_data_if_empty(&self) -> AppResult<()> {
        let mut conn = self.conn();
        let workspace_count = count_table(&conn, "workspace")?;
        if workspace_count > 0 {
            return Ok(());
        }

        let transaction = conn.transaction()?;
        let now = Local::now().to_rfc3339();
        let demo_session_time = "2026-06-08T19:12:00+08:00".to_string();

        transaction.execute(
            "INSERT INTO workspace (name, server_name, season_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params!["示例工作区", "三谋一服", "2026 S1", now],
        )?;
        let workspace_id = transaction.last_insert_rowid();

        transaction.execute(
            "INSERT INTO alliance (workspace_id, alliance_game_id, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![workspace_id, "A-001", "青龙盟", demo_session_time,],
        )?;
        let alliance_id = transaction.last_insert_rowid();

        let seed_summary = |capture_type: &str, note: &str| CaptureSessionSummaryRecord {
            collector: "seed".to_string(),
            status: "seeded".to_string(),
            note: note.to_string(),
            capture: CaptureSessionCapture::Typed(Box::new(CollectorCapturePayload {
                collector_mode: "seed".to_string(),
                capture_type: capture_type.to_string(),
                flow: "seeded".to_string(),
                expected_artifacts: vec![],
                navigation: vec![],
                next_probe: None,
                preview: None,
                runtime: None,
                evidence: None,
            })),
            sidecar_session_id: None,
            preview_insert_counts: None,
            raw_artifact: None,
        };

        transaction.execute(
            "INSERT INTO capture_session
               (workspace_id, alliance_id, capture_type, status, started_at, summary_json)
             VALUES (?1, ?2, 'seed_demo', 'seeded', ?3, ?4)",
            params![
                workspace_id,
                alliance_id,
                demo_session_time,
                serde_json::to_string(&seed_summary(
                    "seed_demo",
                    "demo workspace seeded on first launch"
                ))?
            ],
        )?;
        let session_id = transaction.last_insert_rowid();

        let raw_artifacts = vec![
            (
                "rpc_dump",
                "raw/alliance-rpc-dump/20260608_191200.bin",
                Some("__install_alliance_rpc_hooks__"),
                Some("SRPC_RPCReqUnionInfoResponse"),
                "2026-06-08T19:12:00+08:00",
                "seed-rpc-dump",
            ),
            (
                "ui_snapshot",
                "raw/alliance-ui-snapshot/UnionMainUI.bin",
                Some("UI.Control.UnionMainUI"),
                None,
                "2026-06-08T19:12:30+08:00",
                "seed-ui-snapshot",
            ),
            (
                "static_config",
                "raw/alliance-static-config/Data.Scenario15.building.bin",
                Some("Data.Scenario15.building"),
                None,
                "2026-06-08T19:13:00+08:00",
                "seed-static-config",
            ),
        ];
        for row in raw_artifacts {
            transaction.execute(
                "INSERT INTO raw_artifact
                  (capture_session_id, path, artifact_type, source_module, source_func, captured_at,
                   sha256, sensitive_scan_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![session_id, row.1, row.0, row.2, row.3, row.4, row.5, "seeded"],
            )?;
        }

        transaction.execute(
            "INSERT INTO player (avatar_id, display_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            // 演示载荷使用虚构玩家、同盟与战报标识，不引用实际采集记录。
            params!["100531", "演示玩家甲", demo_session_time],
        )?;
        let player_1 = transaction.last_insert_rowid();
        transaction.execute(
            "INSERT INTO player (avatar_id, display_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params!["100532", "演示玩家乙", demo_session_time],
        )?;
        let player_2 = transaction.last_insert_rowid();
        transaction.execute(
            "INSERT INTO player (avatar_id, display_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params!["100533", "江东小乔", demo_session_time],
        )?;
        let player_3 = transaction.last_insert_rowid();

        let member_rows = vec![
            ("诸葛亮", "副盟主", 5310, 12840, 220, 1424, 748, "在线"),
            ("祝融夫人", "指挥", 4920, 12210, 180, 1425, 748, "驻守"),
            ("孟获", "成员", 2610, 8300, 90, 1402, 760, "离线"),
        ];
        for row in member_rows {
            transaction.execute(
                "INSERT INTO member_snapshot
                  (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id, avatar_name,
                   state, official_name, legion_name, prosperity, weekly_merit, weekly_contribution,
                   demolition_value, coordinate_x, coordinate_y, is_self, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16)",
                params![
                    session_id,
                    workspace_id,
                    alliance_id,
                    demo_session_time,
                    match row.0 {
                        "诸葛亮" => "100531",
                        "祝融夫人" => "100532",
                        _ => "100533",
                    },
                    row.0,
                    row.7,
                    row.1,
                    "一队",
                    row.3,
                    row.3 / 2,
                    row.2,
                    row.4,
                    row.5,
                    row.6,
                    serde_json::json!({
                        "avatarName": row.0,
                        "officialName": row.1,
                        "weeklyContribution": row.2,
                        "weeklyMerit": row.3,
                        "demolitionValue": row.4,
                        "coordinateX": row.5,
                        "coordinateY": row.6,
                        "status": row.7,
                    })
                    .to_string()
                ],
            )?;
        }

        let logs = vec![
            ("攻城", "张辽", "青龙城", "集结完成，等待指挥确认推进"),
            ("人员", "刘备", "青龙盟", "成员绑定完成，新增 1 人"),
            ("管理", "诸葛亮", "同盟科技", "水战科技升级中"),
        ];
        for (idx, row) in logs.into_iter().enumerate() {
            transaction.execute(
                "INSERT INTO union_log_event
                  (capture_session_id, workspace_id, alliance_id, event_time, log_category, actor_name,
                   target_name, text, raw_event_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    session_id,
                    workspace_id,
                    alliance_id,
                    format!("2026-06-08T{}:00+08:00", 19 - idx as i32),
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    serde_json::json!({
                        "category": row.0,
                        "actor": row.1,
                        "target": row.2,
                        "text": row.3
                    })
                    .to_string()
                ],
            )?;
        }

        let facilities = vec![
            ("同盟大厅", "Lv.8", "升级中", "成员上限 +20"),
            ("科技厅", "Lv.7", "已完成", "研究速度 +12%"),
            ("楼船工坊", "Lv.5", "已完成", "运输容量 +15%"),
        ];
        for row in facilities {
            transaction.execute(
                "INSERT INTO building_snapshot
                  (capture_session_id, workspace_id, alliance_id, observed_at, building_name,
                   level, state, effect, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    session_id,
                    workspace_id,
                    alliance_id,
                    demo_session_time,
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    serde_json::json!({
                        "buildingName": row.0,
                        "level": row.1,
                        "state": row.2,
                        "effect": row.3
                    })
                    .to_string()
                ],
            )?;
        }

        let battle_rows = vec![
            (
                "demo-battle-0033",
                "2014909",
                0,
                "2026-06-08T20:01:00+08:00",
                "1424,748",
                4,
                "胜",
                "attacker_win",
                "演示敌方同盟",
                "祝融夫人 / 孟获 / 诸葛亮",
            ),
            (
                "demo-battle-0034",
                "2014903",
                0,
                "2026-06-08T19:24:00+08:00",
                "1428,752",
                5,
                "负",
                "defender_win",
                "风雷盟",
                "张辽 / 曹操 / 典韦",
            ),
            (
                "demo-battle-0035",
                "2014898",
                0,
                "2026-06-08T18:58:00+08:00",
                "1418,744",
                3,
                "胜",
                "attacker_win",
                "青狼营",
                "赵云 / 关羽 / 刘备",
            ),
        ];
        for row in battle_rows {
            transaction.execute(
                "INSERT INTO battle_block
                  (capture_session_id, workspace_id, alliance_id, battle_id, battle_code, record_index,
                   occurred_at, location, match_type, result, winner_side, attacker_json,
                   defender_json, battlefield_environment_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    session_id,
                    workspace_id,
                    alliance_id,
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    row.4,
                    row.5,
                    row.6,
                    row.7,
                    serde_json::json!({
                        "playerName": "演示玩家甲",
                        "allianceName": "青龙盟",
                        "lineup": row.9
                    })
                    .to_string(),
                    serde_json::json!({
                        "playerName": "演示玩家乙",
                        "allianceName": row.8,
                        "lineup": "未知"
                    })
                    .to_string(),
                    serde_json::json!({
                        "location": row.4,
                        "matchType": row.5,
                        "terrain": "平原",
                        "enemyAlliance": row.8,
                        "source": "RPCGetDetailCombatInfo"
                    })
                    .to_string()
                ],
            )?;
        }

        let lineup_rows = vec![
            (
                "演示敌方同盟·祝融体系",
                "演示玩家甲",
                "祝融夫人 / 孟获 / 诸葛亮",
                "2014909",
                "用户确认",
            ),
            (
                "风雷盟·盾骑体系",
                "演示玩家乙",
                "张辽 / 曹操 / 典韦",
                "2014903",
                "候选阵容",
            ),
        ];
        for row in lineup_rows {
            transaction.execute(
                "INSERT INTO lineup_profile
                  (workspace_id, alliance_id, player_id, side, lineup_fingerprint, label, heroes_json,
                   source_battle_id, confidence, valid_from, valid_to, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, ?10, ?10)",
                params![
                    workspace_id,
                    alliance_id,
                    match row.1 {
                        "演示玩家甲" => player_1,
                        "演示玩家乙" => player_2,
                        _ => player_3,
                    },
                    "enemy",
                    format!("{}|{}", row.0, row.2),
                    row.0,
                    serde_json::json!(row.2.split(" / ").collect::<Vec<_>>()).to_string(),
                    row.3,
                    row.4,
                    demo_session_time
                ],
            )?;
        }

        let bindings = vec![
            (player_1, "100531", "演示玩家甲", "青龙盟", "已绑定"),
            (player_2, "100532", "演示玩家乙", "演示敌方同盟", "待确认"),
            (player_3, "100533", "江东小乔", "青龙盟", "已绑定"),
        ];
        for row in bindings {
            transaction.execute(
                "INSERT INTO alliance_member_binding
                  (workspace_id, alliance_id, player_id, avatar_id, avatar_name, valid_from, valid_to,
                   confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
                params![workspace_id, alliance_id, row.0, row.1, row.2, demo_session_time, row.4],
            )?;
        }

        let history_session_time = "2026-06-01T19:12:00+08:00".to_string();
        transaction.execute(
            "INSERT INTO capture_session
               (workspace_id, alliance_id, capture_type, status, started_at, summary_json)
             VALUES (?1, ?2, 'seed_demo_history', 'seeded', ?3, ?4)",
            params![
                workspace_id,
                alliance_id,
                history_session_time,
                serde_json::to_string(&seed_summary(
                    "seed_demo_history",
                    "historical comparison window seeded for time-range queries"
                ))?
            ],
        )?;
        let history_session_id = transaction.last_insert_rowid();

        let history_raw_artifacts = vec![
            (
                "rpc_dump",
                "raw/alliance-rpc-dump/20260601_191200.bin",
                Some("__install_alliance_rpc_hooks__"),
                Some("SRPC_RPCReqUnionInfoResponse"),
                "2026-06-01T19:12:00+08:00",
                "seed-history-rpc-dump",
            ),
            (
                "ui_snapshot",
                "raw/alliance-ui-snapshot/UnionMainUI-20260601.bin",
                Some("UI.Control.UnionMainUI"),
                None,
                "2026-06-01T19:12:30+08:00",
                "seed-history-ui-snapshot",
            ),
        ];
        for row in history_raw_artifacts {
            transaction.execute(
                "INSERT INTO raw_artifact
                  (capture_session_id, path, artifact_type, source_module, source_func, captured_at,
                   sha256, sensitive_scan_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    history_session_id,
                    row.1,
                    row.0,
                    row.2,
                    row.3,
                    row.4,
                    row.5,
                    "seeded"
                ],
            )?;
        }

        let history_member_rows = vec![
            ("诸葛亮", "副盟主", 4380, 10120, 160, 1421, 747, "在线"),
            ("祝融夫人", "指挥", 4120, 9720, 140, 1422, 748, "驻守"),
        ];
        for row in history_member_rows {
            transaction.execute(
                "INSERT INTO member_snapshot
                  (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id, avatar_name,
                   state, official_name, legion_name, prosperity, weekly_merit, weekly_contribution,
                   demolition_value, coordinate_x, coordinate_y, is_self, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16)",
                params![
                    history_session_id,
                    workspace_id,
                    alliance_id,
                    history_session_time,
                    match row.0 {
                        "诸葛亮" => "100531",
                        "祝融夫人" => "100532",
                        _ => "100533",
                    },
                    row.0,
                    row.7,
                    row.1,
                    "一队",
                    row.3,
                    row.3 / 2,
                    row.2,
                    row.4,
                    row.5,
                    row.6,
                    serde_json::json!({
                        "avatarName": row.0,
                        "officialName": row.1,
                        "weeklyContribution": row.2,
                        "weeklyMerit": row.3,
                        "demolitionValue": row.4,
                        "coordinateX": row.5,
                        "coordinateY": row.6,
                        "status": row.7,
                    })
                    .to_string()
                ],
            )?;
        }

        let history_logs = vec![
            ("攻城", "张辽", "青龙城", "上一轮攻城已结束，准备回收伤兵"),
            ("人员", "刘备", "青龙盟", "成员绑定进入复核阶段"),
        ];
        for (idx, row) in history_logs.into_iter().enumerate() {
            transaction.execute(
                "INSERT INTO union_log_event
                  (capture_session_id, workspace_id, alliance_id, event_time, log_category, actor_name,
                   target_name, text, raw_event_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    history_session_id,
                    workspace_id,
                    alliance_id,
                    format!("2026-06-01T{}:00+08:00", 19 - idx as i32),
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    serde_json::json!({
                        "category": row.0,
                        "actor": row.1,
                        "target": row.2,
                        "text": row.3
                    })
                    .to_string()
                ],
            )?;
        }

        let history_facilities = vec![
            ("同盟大厅", "Lv.7", "升级中", "成员上限 +15"),
            ("科技厅", "Lv.6", "已完成", "研究速度 +10%"),
            ("楼船工坊", "Lv.4", "已完成", "运输容量 +10%"),
        ];
        for row in history_facilities {
            transaction.execute(
                "INSERT INTO building_snapshot
                  (capture_session_id, workspace_id, alliance_id, observed_at, building_name,
                   level, state, effect, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    history_session_id,
                    workspace_id,
                    alliance_id,
                    history_session_time,
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    serde_json::json!({
                        "buildingName": row.0,
                        "level": row.1,
                        "state": row.2,
                        "effect": row.3
                    })
                    .to_string()
                ],
            )?;
        }

        let history_battle_rows = vec![
            (
                "demo-battle-0021",
                "2014809",
                0,
                "2026-06-01T20:08:00+08:00",
                "1418,742",
                4,
                "胜",
                "attacker_win",
                "风雷盟",
                "祝融夫人 / 诸葛亮 / 孟获",
            ),
            (
                "demo-battle-0022",
                "2014803",
                0,
                "2026-06-01T19:21:00+08:00",
                "1426,749",
                5,
                "负",
                "defender_win",
                "青狼营",
                "张辽 / 曹操 / 典韦",
            ),
        ];
        for row in history_battle_rows {
            transaction.execute(
                "INSERT INTO battle_block
                  (capture_session_id, workspace_id, alliance_id, battle_id, battle_code, record_index,
                   occurred_at, location, match_type, result, winner_side, attacker_json,
                   defender_json, battlefield_environment_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    history_session_id,
                    workspace_id,
                    alliance_id,
                    row.0,
                    row.1,
                    row.2,
                    row.3,
                    row.4,
                    row.5,
                    row.6,
                    row.7,
                    serde_json::json!({
                        "playerName": "演示玩家甲",
                        "allianceName": "青龙盟",
                        "lineup": row.9
                    })
                    .to_string(),
                    serde_json::json!({
                        "playerName": "演示玩家乙",
                        "allianceName": row.8,
                        "lineup": "未知"
                    })
                    .to_string(),
                    serde_json::json!({
                        "location": row.4,
                        "matchType": row.5,
                        "terrain": "平原",
                        "enemyAlliance": row.8,
                        "source": "RPCGetDetailCombatInfo"
                    })
                    .to_string()
                ],
            )?;
        }

        let history_lineup_rows = vec![
            (
                "风雷盟·先锋体系",
                "演示玩家甲",
                "祝融夫人 / 诸葛亮 / 祝融夫人",
                "2014809",
                "候选阵容",
            ),
            (
                "青狼营·盾骑体系",
                "演示玩家乙",
                "张辽 / 曹操 / 典韦",
                "2014803",
                "用户确认",
            ),
        ];
        for row in history_lineup_rows {
            transaction.execute(
                "INSERT INTO lineup_profile
                  (workspace_id, alliance_id, player_id, side, lineup_fingerprint, label, heroes_json,
                   source_battle_id, confidence, valid_from, valid_to, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, ?10, ?10)",
                params![
                    workspace_id,
                    alliance_id,
                    match row.1 {
                        "演示玩家甲" => player_1,
                        "演示玩家乙" => player_2,
                        _ => player_3,
                    },
                    "enemy",
                    format!("{}|{}", row.0, row.2),
                    row.0,
                    serde_json::json!(row.2.split(" / ").collect::<Vec<_>>()).to_string(),
                    row.3,
                    row.4,
                    history_session_time
                ],
            )?;
        }

        let history_bindings = vec![
            (player_1, "100531", "演示玩家甲", "青龙盟", "待确认"),
            (player_2, "100532", "演示玩家乙", "演示敌方同盟", "待确认"),
        ];
        for row in history_bindings {
            transaction.execute(
                "INSERT INTO alliance_member_binding
                  (workspace_id, alliance_id, player_id, avatar_id, avatar_name, valid_from, valid_to,
                   confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
                params![
                    workspace_id,
                    alliance_id,
                    row.0,
                    row.1,
                    row.2,
                    history_session_time,
                    row.4
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    }

    pub fn summary(&self, workspace_id: Option<i64>) -> AppResult<WorkspaceSummary> {
        // 阶段3a 优化：旧实现是 8 次独立 COUNT 往返，合并为单条多列 SELECT，
        // 一次取回全部计数（语义与原 count_* 辅助函数完全一致）。
        let connection = self.conn();
        let (workspace_count, alliance_count, capture_session_count, raw_artifact_count, export_job_count, member_snapshot_count, building_snapshot_count, battle_block_count, lineup_profile_count) =
            connection.query_row(
                "SELECT
                    (SELECT COUNT(*) FROM workspace),
                    (SELECT COUNT(*) FROM alliance
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM capture_session
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM raw_artifact
                     JOIN capture_session ON capture_session.id = raw_artifact.capture_session_id
                     WHERE (?1 IS NULL OR capture_session.workspace_id = ?1)),
                    (SELECT COUNT(*) FROM export_job
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM member_snapshot
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM building_snapshot
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM battle_block
                     WHERE (?1 IS NULL OR workspace_id = ?1)),
                    (SELECT COUNT(*) FROM lineup_profile
                     WHERE (?1 IS NULL OR workspace_id = ?1))",
                params![workspace_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )?;
        Ok(WorkspaceSummary {
            workspace_count,
            alliance_count,
            capture_session_count,
            raw_artifact_count,
            export_job_count,
            member_snapshot_count,
            building_snapshot_count,
            battle_block_count,
            lineup_profile_count,
            database_path: self
                .app_data_dir
                .join("sanmou-alliance-manager.db")
                .to_string_lossy()
                .to_string(),
        })
    }

    pub fn query_comparison_stats(
        &self,
        workspace_id: i64,
        from_date: &str,
        to_date: &str,
    ) -> AppResult<ComparisonStats> {
        // RFC3339 字符串范围比较替代旧的 substr(col,1,10) BETWEEN：
        // 时间列不再包函数，idx_*_workspace_time 复合索引可参与范围扫描。
        let (from_bound, to_bound) = rfc3339_day_window(from_date, to_date)?;
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT
                (SELECT COUNT(*) FROM member_snapshot
                 WHERE workspace_id = ?1 AND observed_at >= ?2 AND observed_at < ?3) as members,
                (SELECT COUNT(*) FROM building_snapshot
                 WHERE workspace_id = ?1 AND observed_at >= ?2 AND observed_at < ?3) as buildings,
                (SELECT COUNT(*) FROM battle_block
                 WHERE workspace_id = ?1 AND occurred_at >= ?2 AND occurred_at < ?3) as battles,
                (SELECT COUNT(*) FROM capture_session
                 WHERE workspace_id = ?1 AND started_at >= ?2 AND started_at < ?3) as sessions",
        )?;
        let result = stmt.query_row(params![workspace_id, from_bound, to_bound], |row| {
            Ok(ComparisonStats {
                members: row.get(0)?,
                buildings: row.get(1)?,
                battles: row.get(2)?,
                sessions: row.get(3)?,
            })
        })?;
        Ok(result)
    }

    /// 【internal，deprecated for UI】完整 bundle：包含各表原始 raw_json 与全部大表数据，
    /// 仅供导出/备份/诊断路径使用。前端 IPC 请改用 `app_bundle_summary` + 分片命令。
    pub fn internal_full_bundle(
        &self,
        workspace_id: Option<i64>,
    ) -> AppResult<InternalFullAppBundle> {
        self.internal_full_bundle_with(workspace_id, true)
    }

    /// 【internal，deprecated for UI】同 internal_full_bundle，include_raw_json=false 时
    /// 跳过 member/building/union_group 的 raw_json 大字段。
    fn internal_full_bundle_with(
        &self,
        workspace_id: Option<i64>,
        include_raw_json: bool,
    ) -> AppResult<InternalFullAppBundle> {
        let summary = self.summary(workspace_id)?;
        let workspaces = self.list_workspaces()?;
        let connection = self.conn();
        let capture_sessions = query_capture_sessions(&connection, workspace_id)?;
        let raw_artifacts = query_raw_artifacts(&connection, workspace_id)?;
        let export_jobs = query_export_jobs(&connection, workspace_id)?;
        let member_snapshots =
            query_member_snapshots(&connection, workspace_id, include_raw_json)?;
        let building_snapshots =
            query_building_snapshots(&connection, workspace_id, include_raw_json)?;
        let alliance_members = query_alliance_members(&connection, workspace_id)?;
        let alliance_logs = query_alliance_logs(&connection, workspace_id)?;
        let alliance_facilities = query_alliance_facilities(&connection, workspace_id)?;
        let alliance_groups = query_alliance_groups(&connection, workspace_id, include_raw_json)?;
        let battle_reports = query_battle_reports(&connection, workspace_id)?;
        let lineup_profiles = query_lineup_profiles(&connection, workspace_id)?;
        let member_bindings = query_member_bindings(&connection, workspace_id)?;

        Ok(InternalFullAppBundle {
            summary,
            workspaces,
            capture_sessions,
            raw_artifacts,
            export_jobs,
            member_snapshots,
            building_snapshots,
            alliance_members,
            alliance_logs,
            alliance_facilities,
            alliance_groups,
            battle_reports: battle_reports.clone(),
            featured_battle: battle_reports.first().cloned(),
            lineup_profiles,
            member_bindings,
        })
    }

    /// 前端 IPC 用的瘦身 bundle（阶段3a）：summary + 小表元数据（workspaces/
    /// capture_sessions/raw_artifacts/export_jobs/去重后的成员与设施视图/阵容档案/
    /// 成员绑定）。战报明细、同盟日志、成员/设施快照大表不再携带，前端改走
    /// get_battle_reports_paged / get_alliance_logs_paged / get_member_snapshots。
    /// alliance_groups 的 raw_json 大字段同样跳过（前端生产代码不读取）。
    pub fn app_bundle_summary(&self, workspace_id: Option<i64>) -> AppResult<AppBundle> {
        let summary = self.summary(workspace_id)?;
        let workspaces = self.list_workspaces()?;
        let connection = self.conn();
        let capture_sessions = query_capture_sessions(&connection, workspace_id)?;
        let raw_artifacts = query_raw_artifacts(&connection, workspace_id)?;
        let export_jobs = query_export_jobs(&connection, workspace_id)?;
        let alliance_members = query_alliance_members(&connection, workspace_id)?;
        let alliance_facilities = query_alliance_facilities(&connection, workspace_id)?;
        let alliance_groups = query_alliance_groups(&connection, workspace_id, false)?;
        let lineup_profiles = query_lineup_profiles(&connection, workspace_id)?;
        let member_bindings = query_member_bindings(&connection, workspace_id)?;

        Ok(AppBundle {
            summary,
            workspaces,
            capture_sessions,
            raw_artifacts,
            export_jobs,
            alliance_members,
            alliance_facilities,
            alliance_groups,
            lineup_profiles,
            member_bindings,
        })
    }

    pub fn list_workspaces(&self) -> AppResult<Vec<WorkspaceRecord>> {
        // 阶段3a 优化：旧实现每行 3 个相关子查询（alliance id/name/game_id 各查一遍），
        // 改为先在派生表里按 workspace_id 聚合出最小 alliance.id，再 LEFT JOIN 一次取全列。
        // 返回结构与排序保持不变。
        let connection = self.conn();
        let mut statement = connection.prepare(
            "SELECT workspace.id,
                    workspace.name,
                    workspace.server_name,
                    workspace.season_name,
                    alliance.id AS alliance_id,
                    alliance.name AS alliance_name,
                    alliance.alliance_game_id AS alliance_game_id,
                    workspace.created_at,
                    workspace.updated_at
             FROM workspace
             LEFT JOIN (
                 SELECT workspace_id, MIN(id) AS first_alliance_id
                 FROM alliance
                 GROUP BY workspace_id
             ) AS first_alliance ON first_alliance.workspace_id = workspace.id
             LEFT JOIN alliance ON alliance.id = first_alliance.first_alliance_id
             ORDER BY workspace.updated_at DESC, workspace.id DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                server_name: row.get(2)?,
                season_name: row.get(3)?,
                alliance_id: row.get(4)?,
                alliance_name: row.get(5)?,
                alliance_game_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn create_workspace(
        &self,
        request: CreateWorkspaceRequest,
    ) -> AppResult<CreateWorkspaceResponse> {
        if request.name.trim().is_empty() {
            return Err(AppError::Message("工作区名称不能为空".to_string()));
        }
        // 按字符数校验（String::len 是 UTF-8 字节数，中文名会误报超长）
        if request.name.trim().chars().count() > 128 {
            return Err(AppError::Message(
                "工作区名称过长（最多128字符）".to_string(),
            ));
        }
        if request.server_name.chars().count() > 128 {
            return Err(AppError::Message(
                "服务器名称过长（最多128字符）".to_string(),
            ));
        }
        if request.season_name.chars().count() > 64 {
            return Err(AppError::Message("赛季名称过长（最多64字符）".to_string()));
        }
        if request.alliance_name.chars().count() > 128 {
            return Err(AppError::Message("同盟名称过长（最多128字符）".to_string()));
        }
        let now = Local::now().to_rfc3339();
        let workspace_id = {
            let mut connection = self.conn();
            let transaction = connection.transaction()?;

            transaction.execute(
                "INSERT INTO workspace (name, server_name, season_name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![request.name, request.server_name, request.season_name, now],
            )?;
            let workspace_id = transaction.last_insert_rowid();

            transaction.execute(
                "INSERT INTO alliance (workspace_id, alliance_game_id, name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![
                    workspace_id,
                    request.alliance_game_id,
                    request.alliance_name,
                    now
                ],
            )?;
            let alliance_id = transaction.last_insert_rowid();
            transaction.commit()?;
            (workspace_id, alliance_id)
        };

        let workspace = self
            .list_workspaces()?
            .into_iter()
            .find(|workspace| workspace.id == workspace_id.0)
            .ok_or_else(|| AppError::Message("created workspace was not found".to_string()))?;

        Ok(CreateWorkspaceResponse {
            workspace,
            alliance_id: workspace_id.1,
        })
    }

    pub fn save_member_binding(
        &self,
        request: SaveMemberBindingRequest,
    ) -> AppResult<MemberBindingRow> {
        let now = Local::now().to_rfc3339();
        let mut connection = self.conn();
        let transaction = connection.transaction()?;
        let row = save_member_binding_tx(&transaction, &request, &now)?;
        transaction.commit()?;
        Ok(row)
    }

    pub fn save_member_bindings(
        &self,
        requests: &[SaveMemberBindingRequest],
    ) -> AppResult<usize> {
        let now = Local::now().to_rfc3339();
        let mut connection = self.conn();
        let transaction = connection.transaction()?;
        let mut saved = 0usize;
        for request in requests {
            save_member_binding_tx(&transaction, request, &now)?;
            saved += 1;
        }
        transaction.commit()?;
        Ok(saved)
    }

    pub fn save_lineup_profile(
        &self,
        request: SaveLineupProfileRequest,
    ) -> AppResult<LineupProfileRow> {
        let SaveLineupProfileRequest {
            workspace_id,
            alliance_id,
            player_name,
            player_avatar_id,
            side,
            label,
            heroes,
            source_battle_id,
            confidence,
            notes,
        } = request;

        if player_name.trim().is_empty() {
            return Err(AppError::Message("player_name 不能为空".to_string()));
        }
        if label.trim().is_empty() {
            return Err(AppError::Message("label 不能为空".to_string()));
        }
        if heroes.is_empty() {
            return Err(AppError::Message("heroes 不能为空".to_string()));
        }

        let now = Local::now().to_rfc3339();
        let heroes_display = heroes.join(" / ");
        let heroes_json = serde_json::to_string(&heroes)?;
        let side = side.unwrap_or_else(|| "enemy".to_string());
        let lineup_fingerprint = format!("{}|{}", side, heroes_display);
        let source = source_battle_id
            .as_deref()
            .map(|battle_code| format!("战报 {battle_code}"))
            .unwrap_or_else(|| "手动固定".to_string());

        let mut connection = self.conn();
        let transaction = connection.transaction()?;
        let (resolved_alliance_id, _) =
            resolve_alliance_context(&transaction, workspace_id, alliance_id)?;
        let player_id = upsert_player(
            &transaction,
            player_avatar_id.as_deref(),
            &player_name,
            &now,
        )?;

        transaction.execute(
            "UPDATE lineup_profile
             SET valid_to = ?1,
                 updated_at = ?1
             WHERE workspace_id = ?2
               AND player_id = ?3
               AND lineup_fingerprint = ?4
               AND valid_to IS NULL",
            params![
                now.as_str(),
                workspace_id,
                player_id,
                lineup_fingerprint.as_str()
            ],
        )?;

        transaction.execute(
            "INSERT INTO lineup_profile
              (workspace_id, alliance_id, player_id, side, lineup_fingerprint, label, heroes_json,
               source_battle_id, confidence, valid_from, valid_to, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?10, ?10)",
            params![
                workspace_id,
                resolved_alliance_id,
                player_id,
                side.as_str(),
                lineup_fingerprint.as_str(),
                label.as_str(),
                heroes_json,
                source_battle_id.as_deref(),
                confidence.as_str(),
                now.as_str(),
                notes.as_deref(),
            ],
        )?;
        transaction.commit()?;

        Ok(LineupProfileRow {
            player_id: Some(player_id),
            alliance_id: Some(resolved_alliance_id),
            label,
            player: player_name,
            heroes: heroes_display,
            source,
            confidence,
        })
    }

    pub fn backup_data(&self, target_dir: Option<&Path>) -> AppResult<BackupResult> {
        let base_dir = match target_dir {
            Some(dir) => dir.to_path_buf(),
            None => self.export_root().join("backups"),
        };
        // P2-6 修复：时间戳加毫秒，避免同秒内连续两次备份覆盖同一目录。
        let backup_dir = base_dir.join(format!(
            "sanmou-backup-{}",
            Local::now().format("%Y%m%d-%H%M%S-%3f")
        ));
        fs::create_dir_all(&backup_dir)?;

        let db_backup_path = backup_dir.join("sanmou-alliance-manager.db");
        {
            // 锁内只做数据库本体拷贝（Online Backup API 逐页复制，不阻塞 WAL
            // checkpoint，也不需要 VACUUM 重写全库）；raw 目录递归复制放到
            // 释放锁之后，避免大目录 IO 期间冻结所有数据库访问。
            let conn = self.conn();
            conn.backup(rusqlite::DatabaseName::Main, &db_backup_path, None)?;
        }

        // 备份文件落盘后立即校验完整性（独立连接，不占用全局数据库锁）。
        verify_backup_integrity(&db_backup_path)?;

        let mut total_bytes = fs::metadata(&db_backup_path)?.len();
        let raw_source = self.app_data_dir.join("raw");
        if raw_source.is_dir() {
            total_bytes += copy_dir_recursive(&raw_source, &backup_dir.join("raw"))?;
        }

        Ok(BackupResult {
            path: backup_dir.to_string_lossy().to_string(),
            bytes: total_bytes as i64,
        })
    }

    pub fn restore_data(&self, backup_dir: &Path) -> AppResult<RestoreResult> {
        if !backup_dir.is_dir() {
            return Err(AppError::Message(format!(
                "备份目录不存在：{}",
                backup_dir.display()
            )));
        }
        let staged_db = backup_dir.join("sanmou-alliance-manager.db");
        if !staged_db.is_file() {
            return Err(AppError::Message(format!(
                "备份目录中缺少数据库文件 sanmou-alliance-manager.db：{}",
                backup_dir.display()
            )));
        }
        // P2-7 修复：暂存前先做完整性校验，损坏的备份文件直接拒绝恢复，
        // 避免重启 apply_pending_restore 时把坏库替换进生产路径。
        verify_backup_integrity(&staged_db)?;

        let staging_dir = self.app_data_dir.join("pending-restore");
        if staging_dir.exists() {
            fs::remove_dir_all(&staging_dir)?;
        }
        fs::create_dir_all(&staging_dir)?;
        fs::copy(&staged_db, staging_dir.join("sanmou-alliance-manager.db"))?;
        let staged_raw = backup_dir.join("raw");
        if staged_raw.is_dir() {
            copy_dir_recursive(&staged_raw, &staging_dir.join("raw"))?;
        }

        Ok(RestoreResult {
            staged: true,
            message: "备份已暂存，重启应用后生效".to_string(),
        })
    }
}

/// 打开备份文件执行 `PRAGMA integrity_check`，校验失败即视为备份失败。
fn verify_backup_integrity(db_path: &Path) -> AppResult<()> {
    let check_conn = Connection::open(db_path)?;
    let result: String = check_conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result.trim() != "ok" {
        return Err(AppError::Message(format!(
            "备份文件完整性校验失败：{result}"
        )));
    }
    Ok(())
}

pub(crate) fn apply_pending_restore(app_data_dir: &Path) -> AppResult<bool> {
    let staging_dir = app_data_dir.join("pending-restore");
    if !staging_dir.exists() {
        return Ok(false);
    }

    swap_restored_entry(
        &staging_dir.join("sanmou-alliance-manager.db"),
        &app_data_dir.join("sanmou-alliance-manager.db"),
    )?;
    // Drop leftover WAL sidecar files from the previous database so the
    // restored file is not mixed with stale journal state.
    for suffix in ["-wal", "-shm"] {
        let sidecar = app_data_dir.join(format!("sanmou-alliance-manager.db{suffix}"));
        if sidecar.exists() {
            let backup = app_data_dir.join(format!("sanmou-alliance-manager.db{suffix}.bak"));
            let _ = fs::remove_file(&backup);
            fs::rename(&sidecar, &backup)?;
        }
    }
    swap_restored_entry(&staging_dir.join("raw"), &app_data_dir.join("raw"))?;

    fs::remove_dir_all(&staging_dir)?;
    Ok(true)
}

fn swap_restored_entry(staged: &Path, target: &Path) -> AppResult<()> {
    if !staged.exists() {
        return Ok(());
    }
    let backup = backup_path_for(target);
    if target.exists() {
        if backup.exists() {
            remove_entry(&backup)?;
        }
        fs::rename(target, &backup)?;
    }
    if let Err(error) = fs::rename(staged, target) {
        // Best-effort rollback so the previous live data stays in place.
        if backup.exists() {
            let _ = fs::rename(&backup, target);
        }
        return Err(AppError::from(error));
    }
    Ok(())
}

/// 将 YYYY-MM-DD 日期窗口 [from, to] 展开为 RFC3339 字符串范围
/// [from 当日 00:00:00, to 次日 00:00:00)。端点格式与入库时使用的
/// `Local::now().to_rfc3339()` 一致（同一本地时区偏移），可直接做字符串比较，
/// 让 (workspace_id, 时间列) 复合索引参与范围扫描；语义等价于旧的
/// `substr(col, 1, 10) BETWEEN from AND to`（见固化测试
/// comparison_stats_range_boundaries_follow_date_buckets）。
fn rfc3339_day_window(from_date: &str, to_date: &str) -> AppResult<(String, String)> {
    let parse = |value: &str, label: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
            AppError::Message(format!("{label} 格式应为 YYYY-MM-DD，实际为：{value}"))
        })
    };
    let from = parse(from_date, "from_date")?;
    let to = parse(to_date, "to_date")?;
    let day_after_to = to
        .succ_opt()
        .ok_or_else(|| AppError::Message(format!("to_date 超出日期范围：{to_date}")))?;
    // 与写入库的 Local::now().to_rfc3339() 保持同一偏移格式（如 +08:00）。
    let offset = *Local::now().offset();
    let midnight = |date: NaiveDate| -> AppResult<String> {
        let naive = date.and_hms_opt(0, 0, 0).expect("00:00:00 始终合法");
        // naive 按「本地墙钟时间」解释（与入库的 Local::now() 同语义），不做时区换算；
        // FixedOffset 下 from_local_datetime 总有唯一解。
        offset
            .from_local_datetime(&naive)
            .single()
            .map(|dt| dt.to_rfc3339())
            .ok_or_else(|| AppError::Message("日期窗口端点构造失败".to_string()))
    };
    Ok((midnight(from)?, midnight(day_after_to)?))
}

#[cfg(test)]
mod tests {
    use super::{apply_pending_restore, Database};
    use super::export::csv_cell;
    use super::query::query_member_bindings;
    use crate::models::CollectorCaptureAck;
    use crate::models::{
        CaptureSessionCapture, CaptureSessionSummaryRecord, CreateWorkspaceRequest,
        LineupMatchupInput, SaveLineupProfileRequest, SaveMemberBindingRequest, StartCaptureRequest,
        UpsertLineupStatRequest,
    };
    use chrono::{Local, Utc};
    use rusqlite::params;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn seeds_demo_bundle_on_empty_database() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!("sanmou-alliance-manager-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let bundle = database
            .internal_full_bundle(None)
            .expect("load internal full bundle");

        assert!(bundle.summary.workspace_count >= 1);
        assert!(bundle.summary.raw_artifact_count >= 1);
        assert_eq!(bundle.summary.export_job_count, 0);
        assert!(bundle.summary.building_snapshot_count >= 1);
        assert!(!bundle.alliance_members.is_empty());
        assert_eq!(bundle.alliance_members.len(), 3);
        assert!(!bundle.alliance_logs.is_empty());
        assert!(!bundle.alliance_facilities.is_empty());
        assert_eq!(bundle.alliance_facilities.len(), 3);
        assert!(!bundle.battle_reports.is_empty());
        assert!(!bundle.lineup_profiles.is_empty());
        assert!(!bundle.member_bindings.is_empty());
        assert!(!bundle.member_snapshots.is_empty());
        assert!(!bundle.building_snapshots.is_empty());
        assert!(bundle.capture_sessions.len() >= 2);
        assert!(!bundle.raw_artifacts.is_empty());
        assert!(bundle.export_jobs.is_empty());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn workspace_scoped_bundle_filters_other_workspaces() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!("sanmou-alliance-manager-scope-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let workspace = database
            .create_workspace(CreateWorkspaceRequest {
                name: "第二工作区".to_string(),
                server_name: "测试服".to_string(),
                season_name: "2026 S2".to_string(),
                alliance_name: "青龙二盟".to_string(),
                alliance_game_id: Some("A-002".to_string()),
            })
            .expect("create workspace");
        let scoped = database
            .internal_full_bundle(Some(workspace.workspace.id))
            .expect("load scoped bundle");

        assert!(scoped.workspaces.len() >= 2);
        assert_eq!(
            scoped.summary.workspace_count,
            scoped.workspaces.len() as i64
        );
        assert_eq!(scoped.summary.alliance_count, 1);
        assert_eq!(scoped.summary.capture_session_count, 0);
        assert_eq!(scoped.summary.raw_artifact_count, 0);
        assert_eq!(scoped.summary.export_job_count, 0);
        assert_eq!(scoped.summary.member_snapshot_count, 0);
        assert_eq!(scoped.summary.building_snapshot_count, 0);
        assert_eq!(scoped.summary.battle_block_count, 0);
        assert_eq!(scoped.summary.lineup_profile_count, 0);
        assert!(scoped.alliance_members.is_empty());
        assert!(scoped.alliance_logs.is_empty());
        assert!(scoped.alliance_facilities.is_empty());
        assert!(scoped.battle_reports.is_empty());
        assert!(scoped.lineup_profiles.is_empty());
        assert!(scoped.member_bindings.is_empty());
        assert!(scoped.member_snapshots.is_empty());
        assert!(scoped.building_snapshots.is_empty());
        assert!(scoped.capture_sessions.is_empty());
        assert!(scoped.raw_artifacts.is_empty());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn workspace_name_length_checks_count_characters_not_bytes() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!("sanmou-alliance-manager-len-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let request = |name: String| CreateWorkspaceRequest {
            name,
            server_name: "测试服".to_string(),
            season_name: "2026 S2".to_string(),
            alliance_name: "青龙盟".to_string(),
            alliance_game_id: Some("A-003".to_string()),
        };

        // 中文按字符数计算：128 字通过（旧实现按字节会误报超长）
        let ok_name = "盟".repeat(128);
        database
            .create_workspace(request(ok_name))
            .expect("128 个中文字符应通过");

        // 129 个中文字符应拒绝
        let too_long = "盟".repeat(129);
        let err = database
            .create_workspace(request(too_long))
            .expect_err("129 个中文字符应被拒绝");
        assert!(err.to_string().contains("过长"), "错误信息应提示过长: {err}");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn exports_single_battle_report_json() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-export-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let path = database
            .export_battle_report_json(None, "2014909")
            .expect("export battle report");
        let contents = fs::read_to_string(&path).expect("read exported battle report");
        let bundle_after = database.app_bundle_summary(None).expect("load bundle after export");

        assert!(contents.contains("\"battleCode\": \"2014909\""));
        assert!(contents.contains("fixedLineupCandidates"));
        assert!(bundle_after.summary.export_job_count >= 1);
        assert!(!bundle_after.export_jobs.is_empty());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn capture_session_summary_records_sidecar_note() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-capture-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };
        let bundle_before = database.app_bundle_summary(None).expect("bundle before capture");
        let _preview_payload = serde_json::json!({
            "collectorMode": "preview",
            "captureType": "alliance_data",
            "flow": "alliance_runtime",
            "collectorPayload": {
                "preview": {
                    "memberSnapshots": [{
                        "avatarId": "200001",
                        "avatarName": "预览成员甲",
                        "officialName": "军团长",
                        "legionName": "先锋营",
                        "prosperity": 1234,
                        "weeklyMerit": 567,
                        "weeklyContribution": 890,
                        "demolitionValue": 12,
                        "coordinateX": 1424,
                        "coordinateY": 748,
                        "state": "在线",
                        "isSelf": false,
                        "observedAt": "2026-06-09T10:00:00+08:00"
                    }],
                    "battleBlockList": [{
                        "battleId": "PV-0001",
                        "battleCode": "PV-9001",
                        "recordIndex": 0,
                        "occurredAt": "2026-06-09T10:05:00+08:00",
                        "location": "1424,748",
                        "matchType": 4,
                        "result": "attacker_win",
                        "winnerSide": "attacker",
                        "attackerJson": {
                            "playerName": "预览指挥官",
                            "allianceName": "青龙盟",
                            "lineup": "诸葛亮 / 周瑜 / 黄月英"
                        },
                        "defenderJson": {
                            "playerName": "敌对守将",
                            "allianceName": "白虎盟",
                            "lineup": "张辽 / 司马懿 / 典韦"
                        },
                        "battlefieldEnvironmentJson": {
                            "location": "1424,748",
                            "matchType": 4,
                            "terrain": "平原",
                            "enemyAlliance": "白虎盟"
                        }
                    }],
                    "lineupProfiles": [{
                        "playerName": "预览指挥官",
                        "playerAvatarId": "200001",
                        "side": "enemy",
                        "label": "预览指挥官 / 固定阵容",
                        "heroes": ["诸葛亮", "周瑜", "黄月英"],
                        "sourceBattleId": "PV-9001",
                        "confidence": "preview"
                    }]
                }
            }
        });

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "preview capture started for alliance_data".to_string(),
                    session_id: Some("preview-123".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "flow": "alliance_runtime",
                        "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
                        "navigation": ["同盟首页", "成员列表", "成员详情"]
                    })),
                }),
            )
            .expect("start capture session");

        let summary_json: String = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| row.get(0),
                )
                .expect("capture summary json")
        };
        let summary_value: CaptureSessionSummaryRecord =
            serde_json::from_str(&summary_json).expect("capture summary json value");
        let bundle_after = database.app_bundle_summary(None).expect("bundle after capture");

        assert_eq!(summary_value.collector, "preview");
        assert_eq!(summary_value.status, "running");
        assert_eq!(
            summary_value.note,
            "preview capture started for alliance_data"
        );
        match summary_value.capture {
            CaptureSessionCapture::Typed(payload) => {
                assert_eq!(payload.capture_type, "alliance_data");
                assert_eq!(payload.flow, "alliance_runtime");
                assert_eq!(
                    payload.expected_artifacts,
                    vec!["rpc_dump", "ui_snapshot", "static_config"]
                );
            }
            CaptureSessionCapture::Raw(_) => panic!("expected typed capture payload"),
        }
        assert!(summary_value.raw_artifact.is_some());
        assert_eq!(
            bundle_after.summary.raw_artifact_count,
            bundle_before.summary.raw_artifact_count + 1
        );
        let manifest_row = bundle_after
            .raw_artifacts
            .iter()
            .find(|row| row.artifact_type == "capture_manifest")
            .expect("capture manifest artifact");
        assert!(temp_dir.join(&manifest_row.path).exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn capture_session_failure_is_recorded_with_error_payload() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-failed-capture-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };
        let bundle_before = database
            .app_bundle_summary(None)
            .expect("bundle before failed capture");

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "battle_passive".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("failed".to_string()),
                    message: "collector sidecar 启动失败：timeout".to_string(),
                    session_id: None,
                    payload: Some(serde_json::json!({
                        "collectorMode": "sidecar_error",
                        "captureType": "battle_passive",
                        "error": "timeout"
                    })),
                }),
            )
            .expect("record failed capture session");

        let summary_json: String = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| row.get(0),
                )
                .expect("failed capture summary json")
        };
        let summary_value: CaptureSessionSummaryRecord =
            serde_json::from_str(&summary_json).expect("failed capture summary json value");
        let bundle_after = database
            .app_bundle_summary(None)
            .expect("bundle after failed capture");

        assert_eq!(response.status, "failed");
        assert_eq!(summary_value.collector, "sidecar_error");
        assert_eq!(summary_value.status, "failed");
        assert_eq!(summary_value.note, "collector sidecar 启动失败：timeout");
        match summary_value.capture {
            CaptureSessionCapture::Raw(payload) => {
                assert_eq!(payload["error"], "timeout");
            }
            CaptureSessionCapture::Typed(_) => panic!("expected raw failure payload"),
        }
        assert_eq!(
            bundle_after.summary.capture_session_count,
            bundle_before.summary.capture_session_count + 1
        );
        assert_eq!(
            bundle_after.summary.raw_artifact_count,
            bundle_before.summary.raw_artifact_count + 1
        );
        let manifest_row = bundle_after
            .raw_artifacts
            .iter()
            .find(|row| row.artifact_type == "capture_manifest")
            .expect("failed capture manifest artifact");
        assert_eq!(manifest_row.sensitive_scan_status, "passed");
        assert!(temp_dir.join(&manifest_row.path).exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn sensitive_scan_flags_sensitive_payload_keys() {
        let clean_payload = serde_json::json!({
            "collectorMode": "preview",
            "captureType": "battle_passive",
            "flow": "battle_listener"
        });
        let flagged_payload = serde_json::json!({
            "collectorMode": "preview",
            "credentials": {
                "accessToken": "abc123"
            }
        });

        assert_eq!(
            Database::sensitive_scan_status_for_payload(Some(&clean_payload)),
            "passed"
        );
        assert_eq!(
            Database::sensitive_scan_status_for_payload(Some(&flagged_payload)),
            "flagged"
        );
        assert_eq!(Database::sensitive_scan_status_for_payload(None), "passed");
    }

    #[test]
    fn capture_session_preview_normalization_inserts_rows() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-preview-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };
        let bundle_before = database.app_bundle_summary(None).expect("bundle before capture");

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "preview capture started for alliance_data".to_string(),
                    session_id: Some("preview-456".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "300001",
                                    "avatarName": "preview-member",
                                    "officialName": "commander",
                                    "legionName": "vanguard",
                                    "prosperity": 1234,
                                    "weeklyMerit": 567,
                                    "weeklyContribution": 890,
                                    "demolitionValue": 12,
                                    "coordinateX": 1424,
                                    "coordinateY": 748,
                                    "state": "online",
                                    "isSelf": false,
                                    "observedAt": "2026-06-09T10:00:00+08:00"
                                }],
                                "battleBlockList": [{
                                    "battleId": "PV-0002",
                                    "battleCode": "PV-9002",
                                    "recordIndex": 0,
                                    "occurredAt": "2026-06-09T10:05:00+08:00",
                                    "location": "1424,748",
                                    "matchType": 4,
                                    "endRound": 7,
                                    "result": "attacker_win",
                                    "winnerSide": "attacker",
                                    "attackerJson": {
                                        "playerName": "preview-commander",
                                        "allianceName": "blue-dragon",
                                        "lineup": "zhugeliang / zhouyu / huangyueying"
                                    },
                                    "defenderJson": {
                                        "playerName": "enemy-guard",
                                        "allianceName": "white-tiger",
                                        "lineup": "zhangliao / simayi / dianwei"
                                    },
                                    "battlefieldEnvironmentJson": {
                                        "location": "1424,748",
                                        "matchType": 4,
                                        "terrain": "plain",
                                        "enemyAlliance": "white-tiger"
                                    }
                                }],
                                "lineupProfiles": [{
                                    "playerName": "preview-commander",
                                    "playerAvatarId": "300001",
                                    "side": "enemy",
                                    "label": "preview-commander / fixed lineup",
                                    "heroes": ["zhugeliang", "zhouyu", "huangyueying"],
                                    "sourceBattleId": "PV-9002",
                                    "confidence": "preview"
                                }]
                            }
                        }
                    })),
                }),
            )
            .expect("start capture session");

        let summary_json: String = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| row.get(0),
                )
                .expect("capture summary json")
        };
        let bundle_after = database
            .internal_full_bundle(None)
            .expect("bundle after capture");
        let summary_value: CaptureSessionSummaryRecord =
            serde_json::from_str(&summary_json).expect("summary json value");

        let counts = summary_value
            .preview_insert_counts
            .expect("preview insert counts");
        assert_eq!(counts.member_snapshots, 1);
        assert_eq!(counts.battle_blocks, 1);
        let battle = bundle_after
            .battle_reports
            .iter()
            .find(|row| row.battle_code == "PV-9002")
            .expect("normalized battle block");
        assert_eq!(battle.round, 7, "round 应读取 endRound，而不是 matchType");
        assert_eq!(
            bundle_after.summary.raw_artifact_count,
            bundle_before.summary.raw_artifact_count + 1
        );
        assert_eq!(
            bundle_after.summary.member_snapshot_count,
            bundle_before.summary.member_snapshot_count + 1
        );
        assert_eq!(
            bundle_after.summary.battle_block_count,
            bundle_before.summary.battle_block_count + 1
        );
        assert_eq!(
            bundle_after.summary.lineup_profile_count,
            bundle_before.summary.lineup_profile_count + 1
        );
        let manifest_row = bundle_after
            .raw_artifacts
            .iter()
            .find(|row| row.artifact_type == "capture_manifest")
            .expect("capture manifest artifact");
        assert!(temp_dir.join(&manifest_row.path).exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn capture_preview_falls_back_legion_name_from_previous_session() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir()
            .join(format!("sanmou-alliance-manager-legion-fallback-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        // 第一次采集：legionGroups 完整（模拟 #77 正常会话）
        let _first = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "capture one".to_string(),
                    session_id: Some("preview-fallback-1".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "300001",
                                    "avatarName": "member-a",
                                    "legionName": "",
                                    "legionId": 6,
                                    "observedAt": "2026-08-01T10:00:00+08:00"
                                }],
                                "legionGroups": [{
                                    "legionId": 6,
                                    "legionName": "青锋营",
                                    "memberCount": 64,
                                    "observedAt": "2026-08-01T10:00:00+08:00"
                                }]
                            }
                        }
                    })),
                }),
            )
            .expect("first capture");

        // 第二次采集：legionGroups 为空（模拟 #78+ 游戏侧未返回分组名）
        let _second = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "capture two".to_string(),
                    session_id: Some("preview-fallback-2".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "300002",
                                    "avatarName": "member-b",
                                    "legionName": "",
                                    "legionId": 6,
                                    "observedAt": "2026-08-01T11:00:00+08:00"
                                }]
                            }
                        }
                    })),
                }),
            )
            .expect("second capture");

        // 验证：两行成员的 legion_name 都应为「青锋营」（第二次被历史映射兜底补齐）
        let connection = database.conn();
        let legion_names: Vec<String> = connection
            .prepare(
                "SELECT legion_name FROM member_snapshot
                 WHERE avatar_id IN ('300001', '300002') ORDER BY id ASC",
            )
            .expect("prepare query")
            .query_map([], |row| row.get(0))
            .expect("query map")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect names");
        assert_eq!(legion_names.len(), 2, "应有两行成员快照");
        assert_eq!(legion_names[0], "青锋营", "第一次采集成员分组应来自 legionGroups");
        assert_eq!(legion_names[1], "青锋营", "第二次采集成员分组应被历史映射兜底补齐");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn capture_session_preview_payload_completes_and_normalizes_preview() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-preview-payload-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("completed".to_string()),
                    message: "preview capture completed for alliance_data".to_string(),
                    session_id: Some("preview-payload-session".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "flow": "alliance_runtime",
                        "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
                        "navigation": ["alliance_home", "member_list"],
                        "preview": {
                            "memberSnapshots": [{
                                "avatarId": "preview-001",
                                "avatarName": "preview-member",
                                "officialName": "commander",
                                "observedAt": "2026-06-09T10:00:00+08:00"
                            }],
                            "unionLogs": [{
                                "actorName": "preview-actor",
                                "eventTime": "2026-06-09T10:03:00+08:00",
                                "logCategory": "preview",
                                "text": "preview alliance sample"
                            }],
                            "buildingSnapshots": [{
                                "observedAt": "2026-06-09T10:05:00+08:00",
                                "buildingName": "preview-building",
                                "level": "Lv.7"
                            }]
                        }
                    })),
                }),
            )
            .expect("record preview capture session");

        let row: (String, String) = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT status, summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("preview capture summary json")
        };
        let summary_value: CaptureSessionSummaryRecord =
            serde_json::from_str(&row.1).expect("summary json value");
        let counts = summary_value
            .preview_insert_counts
            .expect("preview insert counts");

        assert_eq!(response.status, "completed");
        assert_eq!(row.0, "completed");
        assert_eq!(summary_value.collector, "preview");
        assert_eq!(summary_value.status, "completed");
        assert_eq!(counts.member_snapshots, 1);
        assert_eq!(counts.union_log_events, 1);
        assert_eq!(counts.building_snapshots, 1);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn capture_session_runtime_evidence_records_raw_artifact() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-runtime-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };
        let bundle_before = database.app_bundle_summary(None).expect("bundle before capture");

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("completed".to_string()),
                    message: "runtime_probe capture completed for alliance_data".to_string(),
                    session_id: Some("runtime-456".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "runtime_probe",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "collectorMode": "runtime_probe",
                            "captureType": "alliance_data",
                            "flow": "alliance_runtime",
                            "expectedArtifacts": ["rpc_dump", "ui_snapshot", "static_config"],
                            "navigation": ["alliance_home"],
                            "nextProbe": "__install_alliance_rpc_hooks__",
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "runtime-1001",
                                    "avatarName": "runtime-member",
                                    "officialName": "runtime-official",
                                    "legionName": "runtime-legion",
                                    "prosperity": 6120,
                                    "observedAt": "2026-06-09T20:30:00+08:00"
                                }]
                            },
                            "runtime": {
                                "mode": "jsonl_replay",
                                "artifactType": "runtime_rpc_dump",
                                "recordCount": 1
                            },
                            "evidence": {
                                "mode": "jsonl_replay",
                                "artifacts": [{
                                    "artifactType": "runtime_rpc_dump",
                                    "source": "test-data/runtime-alliance-rpc.jsonl",
                                    "capturedAt": "2026-06-09T20:30:00+08:00",
                                    "sha256": "runtime-replay-sha",
                                    "recordCount": 1,
                                    "records": [{
                                        "module": "Proxy.AvatarMembers.ImpUnion",
                                        "func": "SRPC_RPCReqUnionMemberInfoResponse",
                                        "returns": {
                                            "memberSnapshots": [{
                                                "avatarId": "runtime-1001",
                                                "avatarName": "runtime-member"
                                            }]
                                        }
                                    }]
                                }]
                            }
                        }
                    })),
                }),
            )
            .expect("start runtime capture session");

        let summary_json: String = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| row.get(0),
                )
                .expect("runtime capture summary json")
        };
        let summary_value: CaptureSessionSummaryRecord =
            serde_json::from_str(&summary_json).expect("runtime summary json value");
        let bundle_after = database.app_bundle_summary(None).expect("bundle after capture");

        assert_eq!(summary_value.collector, "runtime_probe");
        assert_eq!(summary_value.status, "completed");
        assert_eq!(
            summary_value
                .preview_insert_counts
                .expect("runtime preview counts")
                .member_snapshots,
            1
        );
        let raw_artifact = summary_value
            .raw_artifact
            .expect("runtime raw artifact summary");
        assert_eq!(raw_artifact.artifact_type, "runtime_rpc_dump");
        assert_eq!(
            bundle_after.summary.raw_artifact_count,
            bundle_before.summary.raw_artifact_count + 2
        );
        let runtime_row = bundle_after
            .raw_artifacts
            .iter()
            .find(|row| row.artifact_type == "runtime_rpc_dump")
            .expect("runtime raw artifact");
        assert!(temp_dir.join(&runtime_row.path).exists());
        let inserted_raw_artifact_id: i64 = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT raw_artifact_id FROM member_snapshot WHERE avatar_id = ?1 ORDER BY id DESC LIMIT 1",
                    ["runtime-1001"],
                    |row| row.get(0),
                )
                .expect("runtime normalized member raw artifact id")
        };
        assert_eq!(inserted_raw_artifact_id, runtime_row.id);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn saves_lineup_profile_without_source_battle_id_and_reads_bundle() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!(
            "sanmou-alliance-manager-lineup-null-source-{suffix}"
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        database
            .save_lineup_profile(SaveLineupProfileRequest {
                workspace_id,
                alliance_id: Some(alliance_id),
                player_name: "manual-player".to_string(),
                player_avatar_id: None,
                side: Some("enemy".to_string()),
                label: "manual lineup without source".to_string(),
                heroes: vec![
                    "hero-a".to_string(),
                    "hero-b".to_string(),
                    "hero-c".to_string(),
                ],
                source_battle_id: None,
                confidence: "user_confirmed".to_string(),
                notes: None,
            })
            .expect("save lineup profile without source");

        let bundle = database
            .app_bundle_summary(None)
            .expect("bundle after null source lineup");
        let row = bundle
            .lineup_profiles
            .iter()
            .find(|row| row.label == "manual lineup without source")
            .expect("lineup profile row");
        assert_eq!(row.source, "手动固定");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn late_completed_ack_does_not_reopen_stopped_capture_session() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-late-ack-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };
        let request = StartCaptureRequest {
            workspace_id,
            alliance_id: Some(alliance_id),
            capture_type: "alliance_data".to_string(),
        };
        let response = database
            .start_pending_capture_session(&request, "runtime_probe", "running")
            .expect("start pending capture");

        assert_eq!(
            database
                .stop_running_capture_sessions("user stopped")
                .expect("stop running capture"),
            1
        );

        database
            .finish_capture_session(
                response.session_id,
                request,
                CollectorCaptureAck {
                    status: Some("completed".to_string()),
                    message: "late completed ack".to_string(),
                    session_id: Some("runtime-late".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "runtime_probe",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "collectorMode": "runtime_probe",
                            "captureType": "alliance_data",
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "late-member",
                                    "avatarName": "late member"
                                }]
                            }
                        }
                    })),
                },
            )
            .expect("finish late ack");

        let (status, summary_json): (String, String) = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT status, summary_json FROM capture_session WHERE id = ?1",
                    [response.session_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("capture session row")
        };
        let summary: CaptureSessionSummaryRecord =
            serde_json::from_str(&summary_json).expect("summary json");
        let ignored_late_ack_count: i64 = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT COUNT(*) FROM raw_artifact
                     WHERE capture_session_id = ?1 AND artifact_type = 'capture_lifecycle'
                       AND source_func = 'late_ack_ignored'",
                    [response.session_id],
                    |row| row.get(0),
                )
                .expect("ignored late ack artifact count")
        };
        let late_member_count: i64 = {
            let connection = database.conn();
            connection
                .query_row(
                    "SELECT COUNT(*) FROM member_snapshot WHERE avatar_id = 'late-member'",
                    [],
                    |row| row.get(0),
                )
                .expect("late member count")
        };

        assert_eq!(status, "stopped");
        assert_eq!(summary.status, "stopped");
        assert_eq!(summary.note, "user stopped");
        assert_eq!(summary.sidecar_session_id, None);
        let counts = summary
            .preview_insert_counts
            .expect("late ack preview counts");
        assert_eq!(counts.member_snapshots, 0);
        assert_eq!(counts.building_snapshots, 0);
        assert_eq!(counts.union_log_events, 0);
        assert_eq!(counts.battle_blocks, 0);
        assert_eq!(counts.lineup_profiles, 0);
        assert_eq!(late_member_count, 0);
        assert_eq!(ignored_late_ack_count, 1);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn saves_member_binding_and_lineup_profile() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!("sanmou-alliance-manager-write-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        let bundle_before = database.app_bundle_summary(None).expect("bundle before writes");

        let binding = database
            .save_member_binding(SaveMemberBindingRequest {
                workspace_id,
                alliance_id: Some(alliance_id),
                avatar_id: "100999".to_string(),
                avatar_name: "新成员".to_string(),
                confidence: "已绑定".to_string(),
            })
            .expect("save member binding");
        assert_eq!(binding.avatar, "100999");
        assert_eq!(binding.name, "新成员");

        let lineup = database
            .save_lineup_profile(SaveLineupProfileRequest {
                workspace_id,
                alliance_id: Some(alliance_id),
                player_name: "对手甲".to_string(),
                player_avatar_id: None,
                side: Some("enemy".to_string()),
                label: "对手甲·盾骑体系".to_string(),
                heroes: vec!["张辽".to_string(), "曹操".to_string(), "典韦".to_string()],
                source_battle_id: Some("2014909".to_string()),
                confidence: "用户确认".to_string(),
                notes: Some("单战报固定阵容".to_string()),
            })
            .expect("save lineup profile");
        assert_eq!(lineup.player, "对手甲");
        assert_eq!(lineup.heroes, "张辽 / 曹操 / 典韦");

        let bundle_after = database.app_bundle_summary(None).expect("bundle after writes");
        assert_eq!(
            bundle_after.member_bindings.len(),
            bundle_before.member_bindings.len() + 1
        );
        assert_eq!(
            bundle_after.lineup_profiles.len(),
            bundle_before.lineup_profiles.len() + 1
        );
        assert!(bundle_after
            .member_bindings
            .iter()
            .any(|row| row.avatar == "100999" && row.name == "新成员"));
        assert!(bundle_after
            .lineup_profiles
            .iter()
            .any(|row| row.label == "对手甲·盾骑体系" && row.player == "对手甲"));

        let exported = database
            .export_battle_report_json(None, "2014909")
            .expect("export battle report after lineup save");
        let contents = fs::read_to_string(&exported).expect("read exported battle report");
        assert!(contents.contains("fixedLineupCandidates"));
        assert!(contents.contains("对手甲·盾骑体系"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn exports_lineup_library_json_and_csv() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-lineup-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let json_path = database
            .export_lineup_library_json(None)
            .expect("export lineup library json");
        let csv_path = database
            .export_lineup_library_csv(None)
            .expect("export lineup library csv");
        let json_contents = fs::read_to_string(&json_path).expect("read lineup json");
        let csv_contents = fs::read_to_string(&csv_path).expect("read lineup csv");
        let bundle_after = database
            .app_bundle_summary(None)
            .expect("bundle after lineup export");

        assert!(json_contents.contains("\"lineupProfiles\""));
        assert!(json_contents.contains("演示敌方同盟·祝融体系"));
        assert!(csv_contents.contains("label,player,heroes,source,confidence"));
        assert!(csv_contents.contains("演示敌方同盟·祝融体系"));
        assert!(bundle_after.summary.export_job_count >= 2);
        assert!(bundle_after
            .export_jobs
            .iter()
            .any(|job| job.job_kind == "lineup_library" && job.format == "json"));
        assert!(bundle_after
            .export_jobs
            .iter()
            .any(|job| job.job_kind == "lineup_library" && job.format == "csv"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn seeded_demo_sessions_have_structured_summary() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-seed-summary-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let bundle = database.app_bundle_summary(None).expect("bundle after seed");

        let seeded_sessions: Vec<_> = bundle
            .capture_sessions
            .iter()
            .filter(|row| row.capture_type.starts_with("seed_demo"))
            .collect();

        assert_eq!(seeded_sessions.len(), 2);
        for session in seeded_sessions {
            let summary = session.summary.as_ref().expect("seed summary");
            assert_eq!(summary.collector, "seed");
            assert_eq!(summary.status, "seeded");
            match &summary.capture {
                CaptureSessionCapture::Typed(payload) => {
                    assert!(payload.capture_type.starts_with("seed_demo"));
                    assert_eq!(payload.collector_mode, "seed");
                }
                CaptureSessionCapture::Raw(_) => panic!("expected typed seed payload"),
            }
        }

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn legacy_seed_summary_is_upgraded_on_read() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-legacy-summary-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        {
            let connection = database.conn();
            connection
                .execute(
                    "UPDATE capture_session SET summary_json = ?1 WHERE capture_type = 'seed_demo'",
                    [serde_json::json!({
                        "collector": "seed",
                        "note": "demo workspace seeded on first launch"
                    })
                    .to_string()],
                )
                .expect("rewrite seed summary");
        }

        let bundle = database
            .app_bundle_summary(None)
            .expect("bundle after legacy rewrite");
        let session = bundle
            .capture_sessions
            .iter()
            .find(|row| row.capture_type == "seed_demo")
            .expect("seed session");
        let summary = session
            .summary
            .as_ref()
            .expect("legacy summary should decode");

        assert_eq!(summary.collector, "seed");
        assert_eq!(summary.note, "demo workspace seeded on first launch");
        match &summary.capture {
            CaptureSessionCapture::Typed(payload) => {
                assert_eq!(payload.capture_type, "seed_demo");
                assert_eq!(payload.collector_mode, "seed");
                assert_eq!(payload.flow, "seeded");
                assert!(payload.expected_artifacts.is_empty());
            }
            CaptureSessionCapture::Raw(_) => panic!("expected upgraded typed capture payload"),
        }

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn exports_bundle_csv_includes_core_tables() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-bundle-csv-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let bundle_before = database.app_bundle_summary(None).expect("bundle before export");

        let paths = database.export_bundle_csv(None).expect("export bundle csv");
        let bundle_after = database.app_bundle_summary(None).expect("bundle after export");
        let exported_names: Vec<String> = paths
            .iter()
            .map(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();

        assert_eq!(paths.len(), 11);
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("workspace-summary-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("alliance-members-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("alliance-logs-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("alliance-facilities-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("member-snapshots-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("building-snapshots-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("battle-reports-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("lineup-profiles-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("member-bindings-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("capture-sessions-")));
        assert!(exported_names
            .iter()
            .any(|name| name.starts_with("raw-artifacts-")));

        let summary_csv = String::from_utf8(
            fs::read(
                paths
                    .iter()
                    .find(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .map(|name| name.starts_with("workspace-summary-"))
                            .unwrap_or(false)
                    })
                    .expect("summary csv path"),
            )
            .expect("read summary csv bytes"),
        )
        .expect("summary csv utf8")
        .trim_start_matches('\u{feff}')
        .to_string();
        let alliance_members_csv = String::from_utf8(
            fs::read(
                paths
                    .iter()
                    .find(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .map(|name| name.starts_with("alliance-members-"))
                            .unwrap_or(false)
                    })
                    .expect("alliance members csv path"),
            )
            .expect("read alliance members csv bytes"),
        )
        .expect("alliance members csv utf8")
        .trim_start_matches('\u{feff}')
        .to_string();
        let member_snapshots_csv = String::from_utf8(
            fs::read(
                paths
                    .iter()
                    .find(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .map(|name| name.starts_with("member-snapshots-"))
                            .unwrap_or(false)
                    })
                    .expect("member snapshots csv path"),
            )
            .expect("read member snapshots csv bytes"),
        )
        .expect("member snapshots csv utf8")
        .trim_start_matches('\u{feff}')
        .to_string();

        assert!(summary_csv.contains("key,value"));
        assert!(summary_csv.contains("workspaceCount"));
        assert!(summary_csv.contains("databasePath"));
        assert!(alliance_members_csv
            .contains("name,official,contribution,merit,demolition,coord,status"));
        assert!(member_snapshots_csv.contains("rawJson"));
        assert_eq!(
            bundle_after.summary.export_job_count,
            bundle_before.summary.export_job_count + 1
        );
        assert!(bundle_after
            .export_jobs
            .iter()
            .any(|job| job.job_kind == "bundle" && job.format == "csv"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn exports_alliance_member_data_csv_matches_expected_headers() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-member-data-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let path = database
            .export_alliance_member_data_csv(None)
            .expect("export member data csv");
        let bytes = fs::read(&path).expect("read member data csv");
        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        let contents = String::from_utf8(bytes).expect("member data csv utf8");
        let contents = contents.trim_start_matches('\u{feff}');
        let filename = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        assert!(filename.contains("游戏内同盟成员数据"));
        assert!(contents.starts_with("成员,游戏编号,分组,职业,繁荣,武勋/繁荣,本周武勋,本周翻地,本周拆迁值,本周击溃,本周攻城次数,本周攻城杀敌,本周攻城值,本周贡献,历史武勋,主城坐标,入盟时间"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn exports_bundle_html_includes_snapshot_tables() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-alliance-manager-bundle-html-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let bundle_before = database.app_bundle_summary(None).expect("bundle before export");

        let html_path = database
            .export_bundle_html(None)
            .expect("export bundle html");
        let html_contents = fs::read_to_string(&html_path).expect("read bundle html");
        let bundle_after = database.app_bundle_summary(None).expect("bundle after export");

        assert!(html_contents.contains("Member Snapshots"));
        assert!(html_contents.contains("Building Snapshots"));
        assert_eq!(
            bundle_after.summary.export_job_count,
            bundle_before.summary.export_job_count + 1
        );
        assert!(bundle_after
            .export_jobs
            .iter()
            .any(|job| job.job_kind == "bundle" && job.format == "html"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    fn temp_app_data_dir(tag: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir().join(format!("sanmou-alliance-manager-{tag}-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        temp_dir
    }

    fn seeded_ids(database: &Database) -> (i64, i64) {
        let connection = database.conn();
        let workspace_id: i64 = connection
            .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
            .expect("workspace id");
        let alliance_id: i64 = connection
            .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
            .expect("alliance id");
        (workspace_id, alliance_id)
    }

    #[test]
    fn member_binding_save_is_idempotent_for_same_name() {
        let temp_dir = temp_app_data_dir("binding-idempotent");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);
        let request = |name: &str| SaveMemberBindingRequest {
            workspace_id,
            alliance_id: Some(alliance_id),
            avatar_id: "200999".to_string(),
            avatar_name: name.to_string(),
            confidence: "已绑定".to_string(),
        };
        let binding_count = |database: &Database| -> i64 {
            database
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM alliance_member_binding WHERE avatar_id = '200999'",
                    [],
                    |row| row.get(0),
                )
                .expect("binding count")
        };

        database
            .save_member_binding(request("同一名称"))
            .expect("first binding save");
        assert_eq!(binding_count(&database), 1);

        let second = database
            .save_member_binding(request("同一名称"))
            .expect("repeat binding save is a no-op");
        assert_eq!(binding_count(&database), 1);
        assert_eq!(second.name, "同一名称");
        assert_eq!(second.avatar, "200999");

        database
            .save_member_binding(request("改名之后"))
            .expect("rename closes old binding and inserts new row");
        assert_eq!(binding_count(&database), 2);
        let old_valid_to: Option<String> = database
            .conn()
            .query_row(
                "SELECT valid_to FROM alliance_member_binding
                 WHERE avatar_id = '200999' AND avatar_name = '同一名称'",
                [],
                |row| row.get(0),
            )
            .expect("old binding row");
        assert!(old_valid_to.is_some(), "old binding must be closed");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn save_member_bindings_batch_writes_all_in_one_call() {
        let temp_dir = temp_app_data_dir("binding-batch");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);
        let requests: Vec<SaveMemberBindingRequest> = (1..=3)
            .map(|i| SaveMemberBindingRequest {
                workspace_id,
                alliance_id: Some(alliance_id),
                avatar_id: format!("batch-{i}"),
                avatar_name: format!("批量玩家{i}"),
                confidence: "自动绑定".to_string(),
            })
            .collect();
        let saved = database
            .save_member_bindings(&requests)
            .expect("batch save");
        assert_eq!(saved, 3);
        let total: i64 = database
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM alliance_member_binding WHERE avatar_id LIKE 'batch-%'",
                [],
                |row| row.get(0),
            )
            .expect("binding count");
        assert_eq!(total, 3);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn query_member_bindings_returns_latest_row_per_avatar_with_is_active() {
        let temp_dir = temp_app_data_dir("binding-latest");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);
        let request = |name: &str| SaveMemberBindingRequest {
            workspace_id,
            alliance_id: Some(alliance_id),
            avatar_id: "300111".to_string(),
            avatar_name: name.to_string(),
            confidence: "已绑定".to_string(),
        };
        // 同名幂等 + 改名产生两条历史行
        database.save_member_binding(request("旧名")).expect("first");
        database.save_member_binding(request("新名")).expect("rename");

        let bindings =
            query_member_bindings(&database.conn(), Some(workspace_id)).expect("query bindings");
        let rows: Vec<_> = bindings
            .iter()
            .filter(|b| b.avatar == "300111")
            .collect();
        // 每 avatar 只返回最新一行
        assert_eq!(rows.len(), 1, "历史行应被去重为最新一条");
        assert_eq!(rows[0].name, "新名");
        assert!(rows[0].is_active, "最新绑定应为激活状态");

        // 改名后旧名被停用 → 再绑回旧名会新增一行，此时最新行是旧名
        database.save_member_binding(request("旧名")).expect("rebind");
        let bindings =
            query_member_bindings(&database.conn(), Some(workspace_id)).expect("query bindings again");
        let rows: Vec<_> = bindings
            .iter()
            .filter(|b| b.avatar == "300111")
            .collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "旧名");
        assert!(rows[0].is_active);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn finish_capture_session_ignores_missing_session() {
        let temp_dir = temp_app_data_dir("finish-missing");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);

        database
            .finish_capture_session(
                999_999,
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                CollectorCaptureAck {
                    status: Some("completed".to_string()),
                    message: "late ack for a deleted session".to_string(),
                    session_id: None,
                    payload: None,
                },
            )
            .expect("missing session is a silent no-op");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn legacy_aggregate_lineup_matchups_are_cleaned_once() {
        // 2026-09-20（审查 P2）：清理改为「按 app_setting 标记只跑一次」。
        // 老库（没有标记）打开时必须执行清理；执行过之后再次打开不得再删数据
        // ——否则 battle_block 被级联清空后，这条 DELETE 会反复命中历史配对行。
        let temp_dir = temp_app_data_dir("matchup-cleanup");
        let insert_fixtures = |database: &Database| {
            database
                .conn()
                .execute_batch(
                    "INSERT INTO lineup_matchup (
                         workspace_id, attacker_avatar_id, attacker_player_name,
                         attacker_lineup_key, attacker_lineup_label,
                         defender_avatar_id, defender_player_name,
                         defender_lineup_key, defender_lineup_label,
                         outcome, battle_time, battle_code, observed_at)
                     VALUES
                         (1, 'a1', '', 'k1', '', 'd1', '', 'k2', '', 'win', '2026-06-01', 'AGG-1', '2026-06-01T00:00:00+08:00'),
                         (1, 'a1', '张三', 'k3', '', 'd1', '李四', 'k4', '', 'win', '2026-06-01', 'REAL-1', '2026-06-01T00:00:00+08:00'),
                         (1, 'a1', '', 'k5', '', 'd1', '', 'k6', '', 'win', '2026-06-01', '2014909', '2026-06-01T00:00:00+08:00');",
                )
                .expect("insert matchup fixtures");
        };
        let battle_codes = |database: &Database| -> Vec<String> {
            database
                .conn()
                .prepare("SELECT battle_code FROM lineup_matchup ORDER BY battle_code")
                .expect("prepare")
                .query_map([], |row| row.get(0))
                .expect("query")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect")
        };

        {
            // 首次打开：建库 + 写入清理标记
            let database = Database::new(temp_dir.clone()).expect("create database");
            insert_fixtures(&database);
            // 模拟"老库"：抹掉标记，让下次打开重新走一次性清理
            database
                .conn()
                .execute("DELETE FROM app_setting WHERE key = ?1", params![
                    super::APP_SETTING_LEGACY_MATCHUP_CLEANUP_KEY
                ])
                .expect("clear cleanup marker");
        }

        // 老库再次打开：应执行清理，只留真实行与仍在 battle_block 的聚合行
        let database = Database::new(temp_dir.clone()).expect("reopen database");
        assert_eq!(
            battle_codes(&database),
            vec!["2014909".to_string(), "REAL-1".to_string()]
        );

        // 再次写入一条新的聚合行并重开：标记已存在，不得再被删除
        database
            .conn()
            .execute_batch(
                "INSERT INTO lineup_matchup (
                     workspace_id, attacker_avatar_id, attacker_player_name,
                     attacker_lineup_key, attacker_lineup_label,
                     defender_avatar_id, defender_player_name,
                     defender_lineup_key, defender_lineup_label,
                     outcome, battle_time, battle_code, observed_at)
                 VALUES
                     (1, 'a1', '', 'k7', '', 'd1', '', 'k8', '', 'win', '2026-06-02', 'AGG-2', '2026-06-02T00:00:00+08:00');",
            )
            .expect("insert aggregate fixture after cleanup");
        drop(database);
        let database = Database::new(temp_dir.clone()).expect("reopen database again");
        assert!(
            battle_codes(&database).contains(&"AGG-2".to_string()),
            "一次性清理执行过之后不应再删除数据"
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn upsert_lineup_stats_writes_batch_in_one_transaction() {
        let temp_dir = temp_app_data_dir("lineup-stats-batch");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let request = |lineup_key: &str, wins: i64, notes: Option<&str>| UpsertLineupStatRequest {
            workspace_id: 1,
            avatar_id: "100531".to_string(),
            player_name: "演示玩家甲".to_string(),
            alliance_name: "青龙盟".to_string(),
            lineup_key: lineup_key.to_string(),
            label: format!("阵容{lineup_key}"),
            formation_id: "f1".to_string(),
            formation_name: "锥形阵".to_string(),
            hero_ids: vec!["h1".to_string(), "h2".to_string()],
            hero_levels: vec![50, 48],
            avg_evolution: 2.5,
            battles: 10,
            wins,
            losses: 10 - wins,
            draws: 0,
            attack_battles: 6,
            defend_battles: 4,
            total_merit: 1000,
            total_origin_troops: 9000,
            total_remaining_troops: 8000,
            total_wounded: 500,
            total_dead: 500,
            total_enemy_origin_troops: 9000,
            total_enemy_remaining_troops: 7000,
            total_enemy_wounded: 1000,
            total_enemy_dead: 1000,
            loss_exchange_ratio: 1.2,
            last_battle_time: "2026-06-08T20:00:00+08:00".to_string(),
            notes: notes.map(str::to_string),
        };

        let written = database
            .upsert_lineup_stats(&[request("k-a", 7, Some("首批备注")), request("k-b", 3, None)])
            .expect("batch upsert");
        assert_eq!(written, 2);

        // Second batch: same conflict keys, notes = None must keep existing notes.
        let written = database
            .upsert_lineup_stats(&[request("k-a", 8, None)])
            .expect("second batch upsert");
        assert_eq!(written, 1);

        let (wins, notes): (i64, Option<String>) = database
            .conn()
            .query_row(
                "SELECT wins, notes FROM lineup_stat WHERE lineup_key = 'k-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("lineup stat row");
        assert_eq!(wins, 8);
        assert_eq!(notes.as_deref(), Some("首批备注"));
        let total: i64 = database
            .conn()
            .query_row("SELECT COUNT(*) FROM lineup_stat", [], |row| row.get(0))
            .expect("lineup stat count");
        assert_eq!(total, 2);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn upsert_lineup_matchups_writes_batch() {
        let temp_dir = temp_app_data_dir("lineup-matchups-batch");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let input = |battle_code: &str, outcome: &str| LineupMatchupInput {
            workspace_id: 1,
            attacker_avatar_id: "100531".to_string(),
            attacker_player_name: "演示玩家甲".to_string(),
            attacker_lineup_key: "atk-k".to_string(),
            attacker_lineup_label: "祝融体系".to_string(),
            defender_avatar_id: "900001".to_string(),
            defender_player_name: "敌对守将".to_string(),
            defender_lineup_key: "def-k".to_string(),
            defender_lineup_label: "盾骑体系".to_string(),
            outcome: outcome.to_string(),
            battle_time: "2026-06-08T20:01:00+08:00".to_string(),
            battle_code: battle_code.to_string(),
            match_type: 2,
            combat_type: 7,
            scenario_id: 33,
            end_round: 6,
            location: "312,418".to_string(),
        };

        let written = database
            .upsert_lineup_matchups(&[input("B-1", "attacker_win"), input("B-2", "defender_win")])
            .expect("batch matchup upsert");
        assert_eq!(written, 2);

        // Same conflict key upserts instead of duplicating.
        let written = database
            .upsert_lineup_matchups(&[input("B-1", "draw")])
            .expect("conflict upsert");
        assert_eq!(written, 1);

        let bundle = database
            .query_lineup_analysis(Some(1))
            .expect("lineup analysis");
        let b1 = bundle
            .matchups
            .iter()
            .find(|row| row.battle_code == "B-1")
            .expect("B-1 matchup");
        assert_eq!(b1.outcome, "draw");
        assert_eq!(bundle.matchups.len(), 2);

        // S3: 分类列随 upsert 写入并可被 query 读回
        assert_eq!(b1.match_type, 2);
        assert_eq!(b1.combat_type, 7);
        assert_eq!(b1.scenario_id, 33);
        assert_eq!(b1.end_round, 6);
        assert_eq!(b1.location, "312,418");

        // 旧库升级路径：003 建表无分类列时，ensure_* 应补齐（默认值）
        let has_column: bool = database
            .conn()
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('lineup_matchup') WHERE name = 'location'
                )",
                [],
                |row| row.get(0),
            )
            .expect("location column exists");
        assert!(has_column, "migration 005 应补齐 location 列");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn comparison_stats_counts_seed_data_within_window() {
        let temp_dir = temp_app_data_dir("comparison-stats");
        let database = Database::new(temp_dir.clone()).expect("create database");

        let full = database
            .query_comparison_stats(1, "2026-06-01", "2026-06-30")
            .expect("full window stats");
        assert_eq!(full.members, 5);
        assert_eq!(full.buildings, 6);
        assert_eq!(full.battles, 5);
        assert_eq!(full.sessions, 2);

        let single_day = database
            .query_comparison_stats(1, "2026-06-08", "2026-06-08")
            .expect("single day stats");
        assert_eq!(single_day.members, 3);
        assert_eq!(single_day.buildings, 3);
        assert_eq!(single_day.battles, 3);
        assert_eq!(single_day.sessions, 1);

        let empty = database
            .query_comparison_stats(1, "2026-07-01", "2026-07-31")
            .expect("empty window stats");
        assert_eq!(empty.members, 0);

        let _ = fs::remove_dir_all(temp_dir);
    }

    // 固化时间窗口查询的「自然日桶」语义（RFC3339 范围改写前的行为快照）：
    // from/to 为 YYYY-MM-DD，窗口展开为 [from 当日 00:00, to 次日 00:00)，
    // 时间列按 RFC3339 字符串比较；任何比较方式改写（如 substr → 范围比较）
    // 都必须保证本测试结果不变。全链路时间戳均为 Local::now().to_rfc3339()
    // （带时区偏移），种子数据统一用 +08:00 偏移。
    #[test]
    fn comparison_stats_range_boundaries_follow_date_buckets() {
        let temp_dir = temp_app_data_dir("comparison-stats-boundaries");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let response = database
            .create_workspace(CreateWorkspaceRequest {
                name: "边界工作区".to_string(),
                server_name: "一服".to_string(),
                season_name: "赛季".to_string(),
                alliance_name: "边界盟".to_string(),
                alliance_game_id: Some("B-EDGE".to_string()),
            })
            .expect("create workspace");
        let workspace_id = response.workspace.id;
        let alliance_id = response.alliance_id;

        {
            let connection = database.conn();
            connection
                .execute(
                    "INSERT INTO capture_session
                       (workspace_id, alliance_id, capture_type, status, started_at)
                     VALUES (?1, ?2, 'boundary_probe', 'seeded', '2026-06-30T23:59:59+08:00')",
                    params![workspace_id, alliance_id],
                )
                .expect("insert base session");
            let session_id = connection.last_insert_rowid();

            // 5 个边界时间戳：前两个落在 07-01 单日桶，中间两个落在 [07-01, 07-03] 窗口，
            // 最后一个恰好落在窗口外（右开端点）。
            let timestamps = [
                "2026-06-30T23:59:59.999999+08:00",
                "2026-07-01T00:00:00+08:00",
                "2026-07-01T08:30:00.123456+08:00",
                "2026-07-03T23:59:59.999999+08:00",
                "2026-07-04T00:00:00+08:00",
            ];
            for (index, timestamp) in timestamps.iter().enumerate() {
                connection
                    .execute(
                        "INSERT INTO member_snapshot
                           (capture_session_id, workspace_id, alliance_id, observed_at,
                            avatar_id, avatar_name, raw_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, '边界成员', '{}')",
                        params![
                            session_id,
                            workspace_id,
                            alliance_id,
                            timestamp,
                            format!("edge-m{index}")
                        ],
                    )
                    .expect("insert member snapshot");
                connection
                    .execute(
                        "INSERT INTO building_snapshot
                           (capture_session_id, workspace_id, alliance_id, observed_at,
                            building_name, level, state, effect, raw_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, 'Lv.1', '已完成', '', '{}')",
                        params![
                            session_id,
                            workspace_id,
                            alliance_id,
                            timestamp,
                            format!("edge-b{index}")
                        ],
                    )
                    .expect("insert building snapshot");
                connection
                    .execute(
                        "INSERT INTO battle_block
                           (capture_session_id, workspace_id, alliance_id, battle_code, occurred_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            session_id,
                            workspace_id,
                            alliance_id,
                            format!("edge-c{index}"),
                            timestamp
                        ],
                    )
                    .expect("insert battle block");
                connection
                    .execute(
                        "INSERT INTO capture_session
                           (workspace_id, alliance_id, capture_type, status, started_at)
                         VALUES (?1, ?2, ?3, 'seeded', ?4)",
                        params![
                            workspace_id,
                            alliance_id,
                            format!("edge_probe_{index}"),
                            timestamp
                        ],
                    )
                    .expect("insert capture session");
            }
        }

        let window = database
            .query_comparison_stats(workspace_id, "2026-07-01", "2026-07-03")
            .expect("window stats");
        assert_eq!(window.members, 3);
        assert_eq!(window.buildings, 3);
        assert_eq!(window.battles, 3);
        assert_eq!(window.sessions, 3);

        let single_day = database
            .query_comparison_stats(workspace_id, "2026-07-01", "2026-07-01")
            .expect("single day stats");
        assert_eq!(single_day.members, 2);
        assert_eq!(single_day.buildings, 2);
        assert_eq!(single_day.battles, 2);
        assert_eq!(single_day.sessions, 2);

        let before = database
            .query_comparison_stats(workspace_id, "2026-06-30", "2026-06-30")
            .expect("previous day stats");
        assert_eq!(before.members, 1);
        assert_eq!(before.buildings, 1);
        assert_eq!(before.battles, 1);
        // 基础会话（23:59:59）+ edge_probe_0（23:59:59.999999）都落在 06-30 桶内
        assert_eq!(before.sessions, 2);

        let after = database
            .query_comparison_stats(workspace_id, "2026-07-04", "2026-07-04")
            .expect("next day stats");
        assert_eq!(after.members, 1);
        assert_eq!(after.sessions, 1);

        let _ = fs::remove_dir_all(temp_dir);
    }

    // ── 阶段3a 分片查询契约固化 ──
    // 验证三个分页底层查询的过滤窗口（[from, to) 半开）、排序、
    // LIMIT/OFFSET、total 与 latest_only 语义。
    #[test]
    fn paged_shard_queries_honor_window_paging_and_total() {
        let temp_dir = temp_app_data_dir("paged-shard-queries");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let response = database
            .create_workspace(CreateWorkspaceRequest {
                name: "分片工作区".to_string(),
                server_name: "一服".to_string(),
                season_name: "赛季".to_string(),
                alliance_name: "分片盟".to_string(),
                alliance_game_id: Some("B-PAGE".to_string()),
            })
            .expect("create workspace");
        let workspace_id = response.workspace.id;
        let alliance_id = response.alliance_id;

        {
            let connection = database.conn();
            connection
                .execute(
                    "INSERT INTO capture_session
                       (workspace_id, alliance_id, capture_type, status, started_at)
                     VALUES (?1, ?2, 'paged_probe', 'seeded', '2026-07-01T00:00:00+08:00')",
                    params![workspace_id, alliance_id],
                )
                .expect("insert session");
            let session_id = connection.last_insert_rowid();

            // 5 条战报：两条在窗口外（前/后各一），三条在 [07-01, 07-03) 内
            let battles = [
                ("p-b1", "2026-06-30T23:59:59+08:00"),
                ("p-b2", "2026-07-01T08:00:00+08:00"),
                ("p-b3", "2026-07-02T09:00:00+08:00"),
                ("p-b4", "2026-07-02T23:59:59.999999+08:00"),
                ("p-b5", "2026-07-03T00:00:00+08:00"),
            ];
            for (battle_code, occurred_at) in battles {
                connection
                    .execute(
                        "INSERT INTO battle_block
                           (capture_session_id, workspace_id, alliance_id, battle_id, battle_code,
                            record_index, occurred_at, location, match_type, result, winner_side,
                            attacker_json, defender_json, battlefield_environment_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, '1,2', 4, '胜', 'attacker_win',
                                 '{\"lineup\":\"队伍\"}', '{\"playerName\":\"敌将\"}',
                                 '{\"enemyAlliance\":\"敌盟\"}')",
                        params![
                            session_id,
                            workspace_id,
                            alliance_id,
                            format!("b-{battle_code}"),
                            battle_code,
                            occurred_at
                        ],
                    )
                    .expect("insert battle block");
            }

            // 3 条日志：两条 section=成员，一条 section=攻城
            let logs = [
                ("成员", "绑定完成", "2026-07-01T10:00:00+08:00"),
                ("成员", "新增成员", "2026-07-01T11:00:00+08:00"),
                ("攻城", "集结完成", "2026-07-01T12:00:00+08:00"),
            ];
            for (section, text, event_time) in logs {
                connection
                    .execute(
                        "INSERT INTO union_log_event
                           (capture_session_id, workspace_id, alliance_id, event_time,
                            log_category, log_section, actor_name, text, raw_event_json)
                         VALUES (?1, ?2, ?3, ?4, '同盟', ?5, '指挥官', ?6, '{}')",
                        params![session_id, workspace_id, alliance_id, event_time, section, text],
                    )
                    .expect("insert union log event");
            }

            // 2 个成员各 2 条快照（共 4 行）
            let snapshots = [
                ("av-1", "甲", "2026-07-01T08:00:00+08:00", 100i64),
                ("av-1", "甲", "2026-07-02T08:00:00+08:00", 120),
                ("av-2", "乙", "2026-07-01T09:00:00+08:00", 90),
                ("av-2", "乙", "2026-07-02T09:00:00+08:00", 95),
            ];
            for (avatar_id, avatar_name, observed_at, prosperity) in snapshots {
                connection
                    .execute(
                        "INSERT INTO member_snapshot
                           (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id,
                            avatar_name, official_name, legion_name, prosperity, weekly_contribution,
                            weekly_merit, demolition_value, coordinate_x, coordinate_y, raw_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '成员', '一队', ?7, 10, 20, 30, 1, 2, '{}')",
                        params![
                            session_id,
                            workspace_id,
                            alliance_id,
                            observed_at,
                            avatar_id,
                            avatar_name,
                            prosperity
                        ],
                    )
                    .expect("insert member snapshot");
            }
        }

        // 战报：无过滤 total=5；窗口 [07-01, 07-03) 命中 3 条且降序；分页正确
        let all = database
            .query_battle_reports_paged(workspace_id, None, None, 100, 0)
            .expect("paged battle reports");
        assert_eq!(all.total, 5);
        assert_eq!(all.rows.len(), 5);
        assert_eq!(all.rows[0].battle_code, "p-b5");

        let windowed = database
            .query_battle_reports_paged(
                workspace_id,
                Some("2026-07-01T00:00:00+08:00"),
                Some("2026-07-03T00:00:00+08:00"),
                100,
                0,
            )
            .expect("windowed battle reports");
        assert_eq!(windowed.total, 3);
        let codes: Vec<&str> = windowed.rows.iter().map(|row| row.battle_code.as_str()).collect();
        assert_eq!(codes, vec!["p-b4", "p-b3", "p-b2"]);

        let page_two = database
            .query_battle_reports_paged(workspace_id, None, None, 2, 2)
            .expect("second page");
        assert_eq!(page_two.total, 5);
        assert_eq!(page_two.rows.len(), 2);
        assert_eq!(page_two.rows[0].battle_code, "p-b3");
        // 行映射字段不为空（attacker/defender/environment json 提取）
        assert_eq!(page_two.rows[0].lineup, "队伍");
        assert_eq!(page_two.rows[0].enemy_player, "敌将");
        assert_eq!(page_two.rows[0].enemy, "敌盟");

        // 日志：无过滤 total=3；section=成员 只命中 2 条
        let all_logs = database
            .query_alliance_logs_paged(workspace_id, None, 100, 0)
            .expect("paged logs");
        assert_eq!(all_logs.total, 3);
        assert_eq!(all_logs.rows[0].text, "集结完成");

        let member_logs = database
            .query_alliance_logs_paged(workspace_id, Some("成员"), 100, 0)
            .expect("filtered logs");
        assert_eq!(member_logs.total, 2);
        assert!(member_logs.rows.iter().all(|row| row.section == "成员"));

        // 成员快照：latest_only 去重后 total=2 且各取最新一条；否则 total=4
        let latest = database
            .query_member_snapshots_paged(workspace_id, true, 100, 0)
            .expect("latest snapshots");
        assert_eq!(latest.total, 2);
        assert_eq!(latest.rows.len(), 2);
        assert!(latest.rows.iter().all(|row| row.observed_at.starts_with("2026-07-02")));
        assert_eq!(latest.rows[0].raw_json, "{}");

        let history = database
            .query_member_snapshots_paged(workspace_id, false, 100, 0)
            .expect("history snapshots");
        assert_eq!(history.total, 4);
        assert_eq!(history.rows.len(), 4);

        // limit 钳制：0 被钳到 1
        let clamped = database
            .query_battle_reports_paged(workspace_id, None, None, 0, -5)
            .expect("clamped paging");
        assert_eq!(clamped.rows.len(), 1);
        assert_eq!(clamped.total, 5);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn member_activity_alerts_flag_offline_and_low_contribution() {
        let temp_dir = temp_app_data_dir("activity-alerts");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let now_ts = Utc::now().timestamp();
        {
            let connection = database.conn();
            for (avatar_id, name, contribution, last_offline_ts, observed_at) in [
                ("A-old", "老旧离线", 10i64, now_ts - 10 * 86_400, "2026-06-08T10:00:00+08:00"),
                ("A-new", "新近离线", 20, now_ts - 3 * 86_400, "2026-06-08T11:00:00+08:00"),
                ("A-online", "一直在线", 30, 0, "2026-06-08T12:00:00+08:00"),
            ] {
                connection
                    .execute(
                        "INSERT INTO member_snapshot
                           (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id,
                            avatar_name, official_name, weekly_contribution, weekly_merit,
                            last_offline_ts, raw_json)
                         VALUES (1, 1, 1, ?1, ?2, ?3, '成员', ?4, 100, ?5, '{}')",
                        params![observed_at, avatar_id, name, contribution, last_offline_ts],
                    )
                    .expect("insert member snapshot");
            }
            // A stale earlier observation of the same avatar must not win over
            // the latest one.
            connection
                .execute(
                    "INSERT INTO member_snapshot
                       (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id,
                        avatar_name, official_name, weekly_contribution, weekly_merit,
                        last_offline_ts, raw_json)
                     VALUES (1, 1, 1, '2026-06-01T10:00:00+08:00', 'A-online', '一直在线', '成员',
                             999, 100, 0, '{}')",
                    [],
                )
                .expect("insert stale snapshot");
        }

        let alerts = database
            .query_member_activity_alerts(1, 7, 1)
            .expect("activity alerts");

        assert_eq!(alerts.offline_members.len(), 1);
        assert_eq!(alerts.offline_members[0].avatar_id, "A-old");

        // Latest snapshot per avatar only: 3 avatars, lowest contribution first.
        assert_eq!(alerts.low_contribution.len(), 1);
        assert_eq!(alerts.low_contribution[0].avatar_id, "A-old");
        assert_eq!(alerts.low_contribution[0].weekly_contribution, 10);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn cross_workspace_power_series_groups_by_workspace_and_date() {
        let temp_dir = temp_app_data_dir("power-series");
        let database = Database::new(temp_dir.clone()).expect("create database");

        let series = database
            .query_cross_workspace_power_series()
            .expect("power series");
        let own: Vec<_> = series
            .iter()
            .filter(|point| point.workspace_id == 1)
            .collect();

        assert_eq!(own.len(), 2);
        assert_eq!(own[0].date, "2026-06-01");
        assert_eq!(own[0].member_count, 2);
        assert_eq!(own[0].total_weekly_merit, 10120 / 2 + 9720 / 2);
        assert_eq!(own[1].date, "2026-06-08");
        assert_eq!(own[1].member_count, 3);
        assert_eq!(own[1].total_weekly_merit, 12840 / 2 + 12210 / 2 + 8300 / 2);
        assert_eq!(own[1].workspace_name, "示例工作区");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn backup_data_exports_database_and_raw_artifacts() {
        let temp_dir = temp_app_data_dir("backup");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let raw_dir = temp_dir.join("raw").join("capture-manifests");
        fs::create_dir_all(&raw_dir).expect("create raw dir");
        fs::write(raw_dir.join("sample.json"), b"{\"ok\":true}").expect("write raw artifact");

        let target_dir = temp_dir.join("backup-target");
        let result = database
            .backup_data(Some(&target_dir))
            .expect("backup into custom target");
        let backup_dir = PathBuf::from(&result.path);

        assert!(backup_dir.starts_with(&target_dir));
        assert!(backup_dir.join("sanmou-alliance-manager.db").is_file());
        assert!(backup_dir
            .join("raw")
            .join("capture-manifests")
            .join("sample.json")
            .is_file());
        assert!(result.bytes > 0);

        // Restoring from the backup stages a pending-restore directory.
        let restore = database.restore_data(&backup_dir).expect("stage restore");
        assert!(restore.staged);
        assert!(restore.message.contains("重启"));
        assert!(temp_dir
            .join("pending-restore")
            .join("sanmou-alliance-manager.db")
            .is_file());
        assert!(temp_dir
            .join("pending-restore")
            .join("raw")
            .join("capture-manifests")
            .join("sample.json")
            .is_file());

        let invalid = database.restore_data(&temp_dir.join("does-not-exist"));
        assert!(invalid.is_err());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn apply_pending_restore_swaps_staged_files_with_backup() {
        let temp_dir = temp_app_data_dir("restore-swap");
        fs::write(
            temp_dir.join("sanmou-alliance-manager.db"),
            b"old-database-bytes",
        )
        .expect("write live db");
        fs::write(
            temp_dir.join("sanmou-alliance-manager.db-wal"),
            b"old-wal",
        )
        .expect("write live wal");
        let live_raw = temp_dir.join("raw").join("runtime");
        fs::create_dir_all(&live_raw).expect("create live raw");
        fs::write(live_raw.join("old.json"), b"old").expect("write live raw file");

        let staging = temp_dir.join("pending-restore");
        fs::create_dir_all(staging.join("raw")).expect("create staging");
        fs::write(
            staging.join("sanmou-alliance-manager.db"),
            b"new-database-bytes",
        )
        .expect("write staged db");
        fs::write(staging.join("raw").join("new.json"), b"new").expect("write staged raw");

        assert!(apply_pending_restore(&temp_dir).expect("apply restore"));
        assert!(!staging.exists(), "staging directory must be consumed");
        assert_eq!(
            fs::read(temp_dir.join("sanmou-alliance-manager.db")).expect("read swapped db"),
            b"new-database-bytes"
        );
        assert_eq!(
            fs::read(temp_dir.join("raw").join("new.json")).expect("read swapped raw"),
            b"new"
        );
        assert_eq!(
            fs::read(temp_dir.join("sanmou-alliance-manager.db.bak")).expect("read db backup"),
            b"old-database-bytes"
        );
        assert!(temp_dir.join("sanmou-alliance-manager.db-wal.bak").is_file());
        assert!(!temp_dir.join("sanmou-alliance-manager.db-wal").exists());
        assert!(temp_dir.join("raw.bak").join("runtime").join("old.json").is_file());

        // No staging directory -> no-op.
        assert!(!apply_pending_restore(&temp_dir).expect("second apply is a no-op"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn export_battle_report_json_sanitizes_hostile_battle_code() {
        let temp_dir = temp_app_data_dir("battle-export-sanitize");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);
        for battle_code in ["record:0", "../escape"] {
            {
                let connection = database.conn();
                connection
                    .execute(
                        "INSERT INTO battle_block
                           (capture_session_id, workspace_id, alliance_id, battle_id, battle_code, record_index,
                            occurred_at, location, match_type, end_round, result, winner_side,
                            attacker_json, defender_json, battlefield_environment_json)
                         VALUES (1, ?1, ?2, ?3, ?4, 0, '2026-06-08T20:01:00+08:00', '1424,748',
                                 4, 7, '?', 'attacker_win', '{}', '{}', '{}')",
                        params![workspace_id, alliance_id, format!("b-{battle_code}"), battle_code],
                    )
                    .expect("insert hostile battle code");
            }
            let path = database
                .export_battle_report_json(None, battle_code)
                .expect("export with hostile battle code");
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            assert!(
                file_name.starts_with("battle-report-") && file_name.ends_with(".json"),
                "{file_name}"
            );
            assert!(
                !file_name.contains(battle_code),
                "raw battle_code leaked into filename: {file_name}"
            );
            assert!(
                path.starts_with(database.export_root()),
                "export escaped exports dir: {}",
                path.display()
            );
        }
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn preview_legion_fallback_does_not_leak_across_workspaces() {
        let temp_dir = temp_app_data_dir("legion-scope");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);

        // ??? 2 ??????????legion 99 -> "B?"??? capture_session ???
        {
            let connection = database.conn();
            let now = Local::now().to_rfc3339();
            connection
                .execute(
                    "INSERT INTO workspace (name, server_name, season_name, created_at, updated_at)
                     VALUES ('?????', '????', '2026 S1', ?1, ?1)",
                    params![now],
                )
                .expect("create workspace 2");
            let workspace2_id = connection.last_insert_rowid();
            connection
                .execute(
                    "INSERT INTO alliance (workspace_id, name, created_at, updated_at)
                     VALUES (?1, 'B?', ?2, ?2)",
                    params![workspace2_id, now],
                )
                .expect("create alliance 2");
            let alliance2_id = connection.last_insert_rowid();
            connection
                .execute(
                    "INSERT INTO capture_session (workspace_id, alliance_id, capture_type, status, started_at, summary_json)
                     VALUES (?1, ?2, 'alliance_data', 'seeded', ?3, '{}')",
                    params![workspace2_id, alliance2_id, "2026-06-09T10:00:00+08:00"],
                )
                .expect("create session 2");
            let session2_id = connection.last_insert_rowid();
            connection
                .execute(
                    "INSERT INTO union_group
                       (capture_session_id, workspace_id, alliance_id, group_id, group_name, legion_id, legion_name, member_count, observed_at)
                     VALUES (?1, ?2, ?3, 99, 'B?', 99, 'B?', 1, '2026-06-09T10:00:00+08:00')",
                    params![session2_id, workspace2_id, alliance2_id],
                )
                .expect("insert ws2 legion group");
        }

        // ??? 1 ?????? legionId=99 ?? legionName?????????
        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("completed".to_string()),
                    message: "preview".to_string(),
                    session_id: Some("preview-legion".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "preview": {
                                "memberSnapshots": [{
                                    "avatarId": "300099",
                                    "avatarName": "???",
                                    "legionId": 99,
                                    "state": "online",
                                    "observedAt": "2026-06-09T11:00:00+08:00"
                                }]
                            }
                        }
                    })),
                }),
            )
            .expect("start capture");
        assert_eq!(response.status, "completed");

        let connection = database.conn();
        let legion_name: String = connection
            .query_row(
                "SELECT legion_name FROM member_snapshot WHERE avatar_id = '300099'",
                [],
                |row| row.get(0),
            )
            .expect("member row");
        assert_eq!(
            legion_name, "",
            "legion fallback leaked from another workspace: {legion_name}"
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn cross_workspace_power_series_uses_latest_snapshot_per_avatar_per_day() {
        let temp_dir = temp_app_data_dir("power-series-dedup");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);

        // ??????????? avatar ????????????? 2000?
        {
            let connection = database.conn();
            for (hour, merit) in [(1i64, 500i64), (2, 2000)] {
                connection
                    .execute(
                        "INSERT INTO member_snapshot
                           (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id, avatar_name,
                            weekly_merit, season_score)
                         VALUES (1, ?1, ?2, ?3, 'dedup-avatar', '????', ?4, 100)",
                        params![
                            workspace_id,
                            alliance_id,
                            format!("2026-06-08T0{hour}:00:00+08:00"),
                            merit,
                        ],
                    )
                    .expect("insert duplicate snapshot");
            }
        }

        let series = database
            .query_cross_workspace_power_series()
            .expect("power series");
        let own: Vec<_> = series
            .iter()
            .filter(|point| point.workspace_id == workspace_id)
            .collect();
        let june8 = own
            .iter()
            .find(|point| point.date == "2026-06-08")
            .expect("2026-06-08 point");
        // ???? 3 ??? + 1 ??? avatar = 4??????????2000????????
        assert_eq!(june8.member_count, 4);
        assert_eq!(
            june8.total_weekly_merit,
            12840 / 2 + 12210 / 2 + 8300 / 2 + 2000
        );
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn csv_cell_guards_against_formula_injection() {
        assert_eq!(csv_cell("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(csv_cell("+cmd"), "'+cmd");
        assert_eq!(csv_cell("@import"), "'@import");
        assert_eq!(csv_cell("-cmd"), "'-cmd");
        assert_eq!(csv_cell("-123"), "-123");
        assert_eq!(csv_cell("????"), "????");
        assert_eq!(csv_cell("?,??"), "\"?,??\"");
        assert_eq!(csv_cell("?\"??"), "\"?\"\"??\"");
    }

    #[test]
    fn app_bundle_summary_drops_large_tables_but_keeps_counts() {
        let temp_dir = temp_app_data_dir("bundle-slim");
        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = seeded_ids(&database);
        {
            let connection = database.conn();
            connection
                .execute(
                    "INSERT INTO member_snapshot
                       (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id, avatar_name,
                        official_name, state, legion_name, prosperity, weekly_contribution, weekly_merit,
                        demolition_value, coordinate_x, coordinate_y, raw_json)
                     VALUES (1, ?1, ?2, '2026-06-08T21:00:00+08:00', 'raw-avatar', '原始成员',
                             '成员', '在线', '一队', 1000, 200, 100, 50, 1, 2, ?3)",
                    params![workspace_id, alliance_id, r#"{"big":"blob"}"#],
                )
                .expect("insert snapshot with raw json");
        }

        let full = database
            .internal_full_bundle(None)
            .expect("internal full bundle");
        let slim = database.app_bundle_summary(None).expect("slim bundle");

        // 瘦身 bundle 不再携带快照大表，但 summary 计数保持一致
        assert_eq!(
            full.summary.member_snapshot_count,
            slim.summary.member_snapshot_count
        );
        assert!(full.summary.member_snapshot_count >= 1);
        // 导出路径仍能拿到全量数据（含 raw_json）
        let full_row = full
            .member_snapshots
            .iter()
            .find(|row| row.avatar_id == "raw-avatar")
            .expect("full row");
        assert_eq!(full_row.raw_json, r#"{"big":"blob"}"#);
        // 瘦身 bundle 保留小表元数据
        assert_eq!(slim.workspaces.len(), full.workspaces.len());
        assert_eq!(slim.capture_sessions.len(), full.capture_sessions.len());
        assert_eq!(slim.alliance_members.len(), full.alliance_members.len());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_capture_session_removes_row_and_disk_artifacts() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-delete-capture-session-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        // 创建一个 running 会话（会写 capture_manifest raw_artifact + 磁盘文件）
        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "preview capture started".to_string(),
                    session_id: Some("preview-del".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "preview",
                        "captureType": "alliance_data",
                        "flow": "alliance_runtime",
                        "expectedArtifacts": ["rpc_dump"],
                        "navigation": []
                    })),
                }),
            )
            .expect("start capture session");

        let session_id = response.session_id;
        let bundle_before = database
            .app_bundle_summary(None)
            .expect("bundle before delete");

        // 收集该会话的 raw_artifact 磁盘路径（删除前）
        let artifact_paths: Vec<String> = {
            let connection = database.conn();
            let mut statement = connection
                .prepare("SELECT path FROM raw_artifact WHERE capture_session_id = ?1")
                .expect("prepare raw artifact query");
            statement
                .query_map([session_id], |row| row.get::<_, String>(0))
                .expect("query raw artifacts")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect raw artifact paths")
        };
        assert!(!artifact_paths.is_empty(), "session should have artifacts");
        for path in &artifact_paths {
            assert!(
                temp_dir.join(path).exists(),
                "artifact file should exist before delete: {path}"
            );
        }

        // 删除会话
        database
            .delete_capture_session(session_id, workspace_id)
            .expect("delete capture session");

        // 数据库行已删除（外键级联）
        let bundle_after = database
            .app_bundle_summary(None)
            .expect("bundle after delete");
        assert!(
            !bundle_after
                .capture_sessions
                .iter()
                .any(|row| row.id == session_id),
            "capture session row should be gone"
        );
        assert_eq!(
            bundle_after.summary.capture_session_count,
            bundle_before.summary.capture_session_count - 1
        );

        // 磁盘 artifact 文件已删除
        for path in &artifact_paths {
            assert!(
                !temp_dir.join(path).exists(),
                "artifact file should be removed after delete: {path}"
            );
        }

        // 重复删除同一会话应报错（不存在）
        let err = database
            .delete_capture_session(session_id, workspace_id)
            .expect_err("second delete should fail");
        assert!(err.to_string().contains("does not exist"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_capture_session_rejects_other_workspace() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir =
            std::env::temp_dir().join(format!("sanmou-delete-capture-ws-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        let response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "preview capture started".to_string(),
                    session_id: Some("preview-ws".to_string()),
                    payload: None,
                }),
            )
            .expect("start capture session");

        // 用一个不存在的 workspace_id 删除 → 应报"不属于当前工作区"
        let err = database
            .delete_capture_session(response.session_id, 999_999)
            .expect_err("cross-workspace delete should fail");
        assert!(err.to_string().contains("does not belong"));

        // 会话仍然存在
        let bundle = database.app_bundle_summary(None).expect("bundle");
        assert!(
            bundle
                .capture_sessions
                .iter()
                .any(|row| row.id == response.session_id),
            "session should survive cross-workspace delete attempt"
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    /// 同盟情报（新增采集域）全链路：preview → normalize 落库 → 分页查询。
    ///
    /// 覆盖 007 迁移建出的两张表、capture.rs 的 intelSnapshots 落库分支、
    /// query.rs 的两个查询函数，以及 `has_preview_sections` 是否认得该节
    /// —— 少了最后这一条，只含情报的快照会被整段静默丢弃（历史上 unionLogs 就栽在这里）。
    #[test]
    fn capture_preview_persists_alliance_intel_snapshots_and_entries() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_millis();
        let temp_dir = std::env::temp_dir()
            .join(format!("sanmou-alliance-manager-intel-{suffix}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let database = Database::new(temp_dir.clone()).expect("create database");
        let (workspace_id, alliance_id) = {
            let connection = database.conn();
            let workspace_id: i64 = connection
                .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
                .expect("workspace id");
            let alliance_id: i64 = connection
                .query_row("SELECT id FROM alliance LIMIT 1", [], |row| row.get(0))
                .expect("alliance id");
            (workspace_id, alliance_id)
        };

        // 只带 intelSnapshots、不带任何旧节 —— 专门验证 has_preview_sections 认得它
        let _response = database
            .start_capture_session(
                StartCaptureRequest {
                    workspace_id,
                    alliance_id: Some(alliance_id),
                    capture_type: "alliance_data".to_string(),
                },
                Some(CollectorCaptureAck {
                    status: Some("running".to_string()),
                    message: "intel preview".to_string(),
                    session_id: Some("preview-intel-1".to_string()),
                    payload: Some(serde_json::json!({
                        "collectorMode": "collector",
                        "captureType": "alliance_data",
                        "collectorPayload": {
                            "preview": {
                                "intelSnapshots": [
                                    {
                                        "kind": "server_rank",
                                        "subjectKey": "00010006",
                                        "subjectLabel": "繁荣榜·全职业",
                                        "observedAt": "2026-09-20T05:14:28+08:00",
                                        "metrics": { "selfRank": 12, "selfValue": 59723 },
                                        "sourceFunc": "RPCGetRankResponse",
                                        "payload": { "rankType": "00010006" },
                                        "entries": [
                                            { "rank": 1, "subjectKey": "10002061834", "name": "甲",
                                              "unionName": "演示同盟甲", "value": 59723, "extra": { "roleId": 1 } },
                                            { "rank": 2, "subjectKey": "10007057519", "name": "乙",
                                              "unionName": "演示同盟乙", "value": 36898, "extra": {} }
                                        ]
                                    },
                                    {
                                        "kind": "hero_rating",
                                        "subjectKey": "90000004001",
                                        "subjectLabel": "本人阵容红度",
                                        "observedAt": "2026-09-20T05:14:28+08:00",
                                        "metrics": { "heroCount": 1, "fullRedCount": 1, "totalRedScore": 503 },
                                        "sourceFunc": "RPCGetAllAvatarHeroResponse",
                                        "payload": {},
                                        "entries": [
                                            { "rank": 0, "subjectKey": "5021", "name": "钟会",
                                              "unionName": "", "value": 503,
                                              "extra": { "evolution": 5, "enlighten": 3 } }
                                        ]
                                    }
                                ]
                            }
                        }
                    })),
                }),
            )
            .expect("start capture session");

        // 落库计数直接用 SQL 核对（StartCaptureResponse 不含 preview_counts）
        {
            let connection = database.conn();
            let snapshot_count: i64 = connection
                .query_row("SELECT COUNT(*) FROM alliance_intel_snapshot", [], |row| {
                    row.get(0)
                })
                .expect("count snapshots");
            let entry_count: i64 = connection
                .query_row("SELECT COUNT(*) FROM alliance_intel_entry", [], |row| row.get(0))
                .expect("count entries");
            assert_eq!(snapshot_count, 2, "两份情报快照都应落库");
            assert_eq!(entry_count, 3, "榜单 2 条 + 红度 1 条");
        }

        // 分页查询：不按类型过滤应拿到 2 份快照
        let all = database
            .query_intel_snapshots_paged(workspace_id, None, 50, 0)
            .expect("query all snapshots");
        assert_eq!(all.total, 2);

        // 按类型过滤（这是前端 tab 的实际用法）
        let ranks = database
            .query_intel_snapshots_paged(workspace_id, Some("server_rank"), 50, 0)
            .expect("query rank snapshots");
        assert_eq!(ranks.total, 1);
        let rank_snapshot = &ranks.rows[0];
        assert_eq!(rank_snapshot.subject_key, "00010006");
        assert_eq!(rank_snapshot.subject_label, "繁荣榜·全职业");
        assert_eq!(rank_snapshot.entry_count, 2);
        assert_eq!(rank_snapshot.source_func, "RPCGetRankResponse");
        // metrics 必须原样带上，前端 KPI 卡片要用
        assert!(rank_snapshot.metrics_json.contains("59723"));

        // 明细：rank 升序
        let entries = database
            .query_intel_entries(workspace_id, rank_snapshot.id, 50, 0)
            .expect("query rank entries");
        assert_eq!(entries.total, 2);
        assert_eq!(entries.rows[0].rank, 1);
        assert_eq!(entries.rows[0].name, "甲");
        assert_eq!(entries.rows[0].value, 59723.0);
        assert_eq!(entries.rows[1].rank, 2);

        // rank=0 的行（武将红度）排在有名次的行之后，且跨快照不串数据
        let hero_snapshots = database
            .query_intel_snapshots_paged(workspace_id, Some("hero_rating"), 50, 0)
            .expect("query hero snapshots");
        assert_eq!(hero_snapshots.total, 1);
        let hero_entries = database
            .query_intel_entries(workspace_id, hero_snapshots.rows[0].id, 50, 0)
            .expect("query hero entries");
        assert_eq!(hero_entries.total, 1);
        assert_eq!(hero_entries.rows[0].rank, 0);
        assert_eq!(hero_entries.rows[0].value, 503.0);
        assert!(hero_entries.rows[0].extra_json.contains("enlighten"));

        // 同一次采集重复投递（同 kind + subjectKey + observedAt）不应产生重复快照
        let again = database
            .query_intel_snapshots_paged(workspace_id, Some("server_rank"), 50, 0)
            .expect("requery");
        assert_eq!(again.total, 1, "UNIQUE(workspace_id, kind, subject_key, observed_at) 应去重");

        let _ = fs::remove_dir_all(temp_dir);
    }
}
