use crate::error::{AppError, AppResult};
use crate::proc_util::{hide_subprocess_window, kill_process_tree};
use chrono::{Local, Utc};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::helpers::{parse_weekly_statistics, sanitize_filename_component, write_text_if_changed};
use super::query::{
    format_join_time, query_battle_report_by_code, query_latest_member_snapshots,
    query_lineup_profiles_for_battle_code, weekly_stat_number,
};
use super::Database;

impl Database {
    pub fn export_bundle_json(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let file_name = format!("bundle-{}.json", Utc::now().format("%Y%m%d-%H%M%S-%3f"));
        let path = exports_dir.join(file_name);
        let json = serde_json::to_vec_pretty(&bundle)?;
        fs::write(&path, json)?;
        self.record_export_job(
            "bundle",
            "json",
            "workspace-bundle",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "bundle",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_bundle_html(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let path = exports_dir.join(format!("bundle-{stamp}.html"));
        let summary = &bundle.summary;
        let body = format!(
            "{}{}{}{}{}{}{}{}{}{}{}",
            html_metric_grid(&[
                ("工作区", summary.workspace_count.to_string()),
                ("同盟", summary.alliance_count.to_string()),
                ("采集会话", summary.capture_session_count.to_string()),
                ("原始证据", summary.raw_artifact_count.to_string()),
                ("成员快照", summary.member_snapshot_count.to_string()),
                ("设施快照", summary.building_snapshot_count.to_string()),
                ("战报块", summary.battle_block_count.to_string()),
                ("阵容档案", summary.lineup_profile_count.to_string()),
            ]),
            html_table_section(
                "同盟成员",
                &[
                    "name",
                    "official",
                    "contribution",
                    "merit",
                    "demolition",
                    "coord",
                    "status",
                    "lastOfflineTs"
                ],
                bundle
                    .alliance_members
                    .iter()
                    .map(|row| {
                        vec![
                            row.name.clone(),
                            row.official.clone(),
                            row.contribution.to_string(),
                            row.merit.to_string(),
                            row.demolition.to_string(),
                            row.coord.clone(),
                            row.status.clone(),
                            row.last_offline_ts.to_string(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "同盟日志",
                &["time", "category", "section", "actor", "target", "text"],
                bundle
                    .alliance_logs
                    .iter()
                    .map(|row| {
                        vec![
                            row.time.clone(),
                            row.category.clone(),
                            row.section.clone(),
                            row.actor.clone(),
                            row.target.clone(),
                            row.text.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "设施与科技",
                &["name", "level", "state", "effect"],
                bundle
                    .alliance_facilities
                    .iter()
                    .map(|row| {
                        vec![
                            row.name.clone(),
                            row.level.clone(),
                            row.state.clone(),
                            row.effect.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "Member Snapshots",
                &[
                    "id",
                    "captureSessionId",
                    "observedAt",
                    "avatarId",
                    "avatarName",
                    "officialName",
                    "state",
                    "isOnline",
                    "roleId",
                    "legionName",
                    "legionId",
                    "legionLeader",
                    "prosperity",
                    "weeklyContribution",
                    "weeklyMerit",
                    "seasonScore",
                    "demolitionValue",
                    "coordinateX",
                    "coordinateY",
                    "lastOfflineTs",
                    "joinTs",
                    "tFeat",
                    "tForageUse",
                    "wForageUse",
                    "weeklyStatisticsJson",
                    "rawJson",
                ],
                bundle
                    .member_snapshots
                    .iter()
                    .map(|row| {
                        vec![
                            row.id.to_string(),
                            row.capture_session_id.to_string(),
                            row.observed_at.clone(),
                            row.avatar_id.clone(),
                            row.avatar_name.clone(),
                            row.official_name.clone(),
                            row.state.clone().unwrap_or_default(),
                            row.is_online.to_string(),
                            row.role_id.to_string(),
                            row.legion_name.clone(),
                            row.legion_id.to_string(),
                            row.legion_leader.to_string(),
                            row.prosperity.to_string(),
                            row.weekly_contribution.to_string(),
                            row.weekly_merit.to_string(),
                            row.season_score.to_string(),
                            row.demolition_value.to_string(),
                            row.coordinate_x.to_string(),
                            row.coordinate_y.to_string(),
                            row.last_offline_ts.to_string(),
                            row.join_ts.to_string(),
                            row.t_feat.to_string(),
                            row.t_forage_use.to_string(),
                            row.w_forage_use.to_string(),
                            row.weekly_statistics_json.clone(),
                            row.raw_json.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "Building Snapshots",
                &[
                    "id",
                    "captureSessionId",
                    "observedAt",
                    "buildingName",
                    "facilityType",
                    "facilityTypeId",
                    "roleFacilityType",
                    "cfgId",
                    "carrierId",
                    "level",
                    "state",
                    "statusId",
                    "coordinateX",
                    "coordinateY",
                    "operatorAvatarId",
                    "operatorName",
                    "benefit",
                    "mineCount",
                    "maxMineCount",
                    "effect",
                    "rawJson",
                ],
                bundle
                    .building_snapshots
                    .iter()
                    .map(|row| {
                        vec![
                            row.id.to_string(),
                            row.capture_session_id.to_string(),
                            row.observed_at.clone(),
                            row.building_name.clone(),
                            row.facility_type.clone(),
                            row.facility_type_id.to_string(),
                            row.role_facility_type.to_string(),
                            row.cfg_id.to_string(),
                            row.carrier_id.clone(),
                            row.level.clone(),
                            row.state.clone(),
                            row.status_id.to_string(),
                            row.coordinate_x.to_string(),
                            row.coordinate_y.to_string(),
                            row.operator_avatar_id.clone(),
                            row.operator_name.clone(),
                            row.benefit.to_string(),
                            row.mine_count.to_string(),
                            row.max_mine_count.to_string(),
                            row.effect.clone(),
                            row.raw_json.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "战报列表",
                &[
                    "time",
                    "battleCode",
                    "enemy",
                    "enemyPlayer",
                    "result",
                    "round",
                    "location",
                    "lineup"
                ],
                bundle
                    .battle_reports
                    .iter()
                    .map(|row| {
                        vec![
                            row.time.clone(),
                            row.battle_code.clone(),
                            row.enemy.clone(),
                            row.enemy_player.clone(),
                            row.result.clone(),
                            row.round.to_string(),
                            row.location.clone(),
                            row.lineup.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "固定阵容",
                &["label", "player", "heroes", "source", "confidence"],
                bundle
                    .lineup_profiles
                    .iter()
                    .map(|row| {
                        vec![
                            row.label.clone(),
                            row.player.clone(),
                            row.heroes.clone(),
                            row.source.clone(),
                            row.confidence.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "成员绑定",
                &["name", "avatar", "alliance", "status", "updated"],
                bundle
                    .member_bindings
                    .iter()
                    .map(|row| {
                        vec![
                            row.name.clone(),
                            row.avatar.clone(),
                            row.alliance.clone(),
                            row.status.clone(),
                            row.updated.clone(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "采集会话",
                &[
                    "id",
                    "captureType",
                    "status",
                    "startedAt",
                    "finishedAt",
                    "summaryJson"
                ],
                bundle
                    .capture_sessions
                    .iter()
                    .map(|row| {
                        vec![
                            row.id.to_string(),
                            row.capture_type.clone(),
                            row.status.clone(),
                            row.started_at.clone(),
                            row.finished_at.clone().unwrap_or_default(),
                            row.summary_json.clone().unwrap_or_default(),
                        ]
                    })
                    .collect(),
            ),
            html_table_section(
                "原始证据",
                &[
                    "id",
                    "captureSessionId",
                    "artifactType",
                    "path",
                    "sourceModule",
                    "sourceFunc",
                    "capturedAt",
                    "sha256",
                    "sensitiveScanStatus",
                ],
                bundle
                    .raw_artifacts
                    .iter()
                    .map(|row| {
                        vec![
                            row.id.to_string(),
                            row.capture_session_id.to_string(),
                            row.artifact_type.clone(),
                            row.path.clone(),
                            row.source_module.clone().unwrap_or_default(),
                            row.source_func.clone().unwrap_or_default(),
                            row.captured_at.clone(),
                            row.sha256.clone().unwrap_or_default(),
                            row.sensitive_scan_status.clone(),
                        ]
                    })
                    .collect(),
            ),
        );
        fs::write(&path, html_document("工作区总包导出", &body))?;
        self.record_export_job(
            "bundle",
            "html",
            "workspace-bundle",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "bundle",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_bundle_xlsx(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let path = exports_dir.join(format!("bundle-{stamp}.xlsx"));
        let helper_path = self.ensure_export_bundle_xlsx_helper()?;
        let bundle_json = serde_json::to_vec(&bundle)?;
        self.run_python_helper(&helper_path, &path, &bundle_json)?;
        self.record_export_job(
            "bundle",
            "xlsx",
            "workspace-bundle",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "bundle",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_bundle_csv(&self, workspace_id: Option<i64>) -> AppResult<Vec<PathBuf>> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let exported_at = Local::now().to_rfc3339();
        let mut output_paths = Vec::new();

        fn export_csv_file(
            exports_dir: &Path,
            output_paths: &mut Vec<PathBuf>,
            filename: String,
            headers: &[&str],
            rows: Vec<Vec<String>>,
        ) -> AppResult<PathBuf> {
            let path = exports_dir.join(filename);
            write_csv(&path, headers, rows)?;
            output_paths.push(path.clone());
            Ok(path)
        }

        let _summary_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("workspace-summary-{stamp}.csv"),
            &["key", "value"],
            vec![
                vec!["exportedAt".to_string(), exported_at.clone()],
                vec![
                    "workspaceCount".to_string(),
                    bundle.summary.workspace_count.to_string(),
                ],
                vec![
                    "allianceCount".to_string(),
                    bundle.summary.alliance_count.to_string(),
                ],
                vec![
                    "captureSessionCount".to_string(),
                    bundle.summary.capture_session_count.to_string(),
                ],
                vec![
                    "rawArtifactCount".to_string(),
                    bundle.summary.raw_artifact_count.to_string(),
                ],
                vec![
                    "exportJobCount".to_string(),
                    bundle.summary.export_job_count.to_string(),
                ],
                vec![
                    "memberSnapshotCount".to_string(),
                    bundle.summary.member_snapshot_count.to_string(),
                ],
                vec![
                    "buildingSnapshotCount".to_string(),
                    bundle.summary.building_snapshot_count.to_string(),
                ],
                vec![
                    "battleBlockCount".to_string(),
                    bundle.summary.battle_block_count.to_string(),
                ],
                vec![
                    "lineupProfileCount".to_string(),
                    bundle.summary.lineup_profile_count.to_string(),
                ],
                vec![
                    "databasePath".to_string(),
                    bundle.summary.database_path.clone(),
                ],
            ],
        )?;

        let _alliance_members_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("alliance-members-{stamp}.csv"),
            &[
                "name",
                "official",
                "contribution",
                "merit",
                "demolition",
                "coord",
                "status",
                "lastOfflineTs",
            ],
            bundle
                .alliance_members
                .iter()
                .map(|row| {
                    vec![
                        row.name.clone(),
                        row.official.clone(),
                        row.contribution.to_string(),
                        row.merit.to_string(),
                        row.demolition.to_string(),
                        row.coord.clone(),
                        row.status.clone(),
                        row.last_offline_ts.to_string(),
                    ]
                })
                .collect(),
        )?;

        let _alliance_logs_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("alliance-logs-{stamp}.csv"),
            &["time", "category", "section", "actor", "target", "text"],
            bundle
                .alliance_logs
                .iter()
                .map(|row| {
                    vec![
                        row.time.clone(),
                        row.category.clone(),
                        row.section.clone(),
                        row.actor.clone(),
                        row.target.clone(),
                        row.text.clone(),
                    ]
                })
                .collect(),
        )?;

        let _alliance_facilities_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("alliance-facilities-{stamp}.csv"),
            &["name", "level", "state", "effect"],
            bundle
                .alliance_facilities
                .iter()
                .map(|row| {
                    vec![
                        row.name.clone(),
                        row.level.clone(),
                        row.state.clone(),
                        row.effect.clone(),
                    ]
                })
                .collect(),
        )?;

        let _member_snapshots_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("member-snapshots-{stamp}.csv"),
            &[
                "id",
                "captureSessionId",
                "observedAt",
                "avatarId",
                "avatarName",
                "officialName",
                "state",
                "isOnline",
                "roleId",
                "legionName",
                "legionId",
                "legionLeader",
                "prosperity",
                "weeklyContribution",
                "weeklyMerit",
                "seasonScore",
                "demolitionValue",
                "coordinateX",
                "coordinateY",
                "lastOfflineTs",
                "joinTs",
                "tFeat",
                "tForageUse",
                "wForageUse",
                "weeklyStatisticsJson",
                "rawJson",
            ],
            bundle
                .member_snapshots
                .iter()
                .map(|row| {
                    vec![
                        row.id.to_string(),
                        row.capture_session_id.to_string(),
                        row.observed_at.clone(),
                        row.avatar_id.clone(),
                        row.avatar_name.clone(),
                        row.official_name.clone(),
                        row.state.clone().unwrap_or_default(),
                        row.is_online.to_string(),
                        row.role_id.to_string(),
                        row.legion_name.clone(),
                        row.legion_id.to_string(),
                        row.legion_leader.to_string(),
                        row.prosperity.to_string(),
                        row.weekly_contribution.to_string(),
                        row.weekly_merit.to_string(),
                        row.season_score.to_string(),
                        row.demolition_value.to_string(),
                        row.coordinate_x.to_string(),
                        row.coordinate_y.to_string(),
                        row.last_offline_ts.to_string(),
                        row.join_ts.to_string(),
                        row.t_feat.to_string(),
                        row.t_forage_use.to_string(),
                        row.w_forage_use.to_string(),
                        row.weekly_statistics_json.clone(),
                        row.raw_json.clone(),
                    ]
                })
                .collect(),
        )?;

        let _building_snapshots_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("building-snapshots-{stamp}.csv"),
            &[
                "id",
                "captureSessionId",
                "observedAt",
                "buildingName",
                "facilityType",
                "facilityTypeId",
                "roleFacilityType",
                "cfgId",
                "carrierId",
                "level",
                "state",
                "statusId",
                "coordinateX",
                "coordinateY",
                "operatorAvatarId",
                "operatorName",
                "benefit",
                "mineCount",
                "maxMineCount",
                "effect",
                "rawJson",
            ],
            bundle
                .building_snapshots
                .iter()
                .map(|row| {
                    vec![
                        row.id.to_string(),
                        row.capture_session_id.to_string(),
                        row.observed_at.clone(),
                        row.building_name.clone(),
                        row.facility_type.clone(),
                        row.facility_type_id.to_string(),
                        row.role_facility_type.to_string(),
                        row.cfg_id.to_string(),
                        row.carrier_id.clone(),
                        row.level.clone(),
                        row.state.clone(),
                        row.status_id.to_string(),
                        row.coordinate_x.to_string(),
                        row.coordinate_y.to_string(),
                        row.operator_avatar_id.clone(),
                        row.operator_name.clone(),
                        row.benefit.to_string(),
                        row.mine_count.to_string(),
                        row.max_mine_count.to_string(),
                        row.effect.clone(),
                        row.raw_json.clone(),
                    ]
                })
                .collect(),
        )?;

        let _battle_reports_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("battle-reports-{stamp}.csv"),
            &[
                "time",
                "battleCode",
                "battleId",
                "enemy",
                "enemyPlayer",
                "result",
                "round",
                "location",
                "lineup",
                "battlefieldEnvironmentJson",
            ],
            bundle
                .battle_reports
                .iter()
                .map(|row| {
                    vec![
                        row.time.clone(),
                        row.battle_code.clone(),
                        row.battle_id.clone(),
                        row.enemy.clone(),
                        row.enemy_player.clone(),
                        row.result.clone(),
                        row.round.to_string(),
                        row.location.clone(),
                        row.lineup.clone(),
                        row.battlefield_environment_json.clone(),
                    ]
                })
                .collect(),
        )?;

        let _lineup_profiles_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("lineup-profiles-{stamp}.csv"),
            &["label", "player", "heroes", "source", "confidence"],
            bundle
                .lineup_profiles
                .iter()
                .map(|row| {
                    vec![
                        row.label.clone(),
                        row.player.clone(),
                        row.heroes.clone(),
                        row.source.clone(),
                        row.confidence.clone(),
                    ]
                })
                .collect(),
        )?;

        let _member_bindings_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("member-bindings-{stamp}.csv"),
            &["name", "avatar", "alliance", "status", "updated"],
            bundle
                .member_bindings
                .iter()
                .map(|row| {
                    vec![
                        row.name.clone(),
                        row.avatar.clone(),
                        row.alliance.clone(),
                        row.status.clone(),
                        row.updated.clone(),
                    ]
                })
                .collect(),
        )?;

        let _capture_sessions_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("capture-sessions-{stamp}.csv"),
            &[
                "id",
                "captureType",
                "status",
                "startedAt",
                "finishedAt",
                "summaryJson",
            ],
            bundle
                .capture_sessions
                .iter()
                .map(|row| {
                    vec![
                        row.id.to_string(),
                        row.capture_type.clone(),
                        row.status.clone(),
                        row.started_at.clone(),
                        row.finished_at.clone().unwrap_or_default(),
                        row.summary_json.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        )?;

        let _raw_artifacts_path = export_csv_file(
            &exports_dir,
            &mut output_paths,
            format!("raw-artifacts-{stamp}.csv"),
            &[
                "id",
                "captureSessionId",
                "artifactType",
                "path",
                "sourceModule",
                "sourceFunc",
                "capturedAt",
                "sha256",
                "sensitiveScanStatus",
            ],
            bundle
                .raw_artifacts
                .iter()
                .map(|row| {
                    vec![
                        row.id.to_string(),
                        row.capture_session_id.to_string(),
                        row.artifact_type.clone(),
                        row.path.clone(),
                        row.source_module.clone().unwrap_or_default(),
                        row.source_func.clone().unwrap_or_default(),
                        row.captured_at.clone(),
                        row.sha256.clone().unwrap_or_default(),
                        row.sensitive_scan_status.clone(),
                    ]
                })
                .collect(),
        )?;

        self.record_export_job(
            "bundle",
            "csv",
            "workspace-bundle",
            &output_paths,
            serde_json::json!({
                "kind": "bundle",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(output_paths)
    }

    pub fn export_lineup_library_html(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let path = exports_dir.join(format!("lineup-library-{stamp}.html"));
        let body = format!(
            "{}{}",
            html_metric_grid(&[
                ("阵容档案", bundle.lineup_profiles.len().to_string()),
                (
                    "已确认",
                    bundle
                        .lineup_profiles
                        .iter()
                        .filter(|row| row.confidence.contains("确认"))
                        .count()
                        .to_string(),
                ),
            ]),
            html_table_section(
                "固定阵容",
                &["label", "player", "heroes", "source", "confidence"],
                bundle
                    .lineup_profiles
                    .iter()
                    .map(|row| {
                        vec![
                            row.label.clone(),
                            row.player.clone(),
                            row.heroes.clone(),
                            row.source.clone(),
                            row.confidence.clone(),
                        ]
                    })
                    .collect(),
            ),
        );
        fs::write(&path, html_document("固定阵容库导出", &body))?;
        self.record_export_job(
            "lineup_library",
            "html",
            "workspace-lineup-library",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "lineup_library",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_lineup_library_json(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let file_name = format!("lineup-library-{}.json", Utc::now().format("%Y%m%d-%H%M%S-%3f"));
        let path = exports_dir.join(file_name);
        let payload = serde_json::json!({
            "kind": "lineup_library",
            "generatedAt": Local::now().to_rfc3339(),
            "lineupProfiles": bundle.lineup_profiles,
            "workspaceId": workspace_id,
        });
        fs::write(&path, serde_json::to_vec_pretty(&payload)?)?;
        self.record_export_job(
            "lineup_library",
            "json",
            "workspace-lineup-library",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "lineup_library",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_lineup_library_csv(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let bundle = self.internal_full_bundle(workspace_id)?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let path = exports_dir.join(format!("lineup-library-{stamp}.csv"));

        write_csv(
            &path,
            &["label", "player", "heroes", "source", "confidence"],
            bundle
                .lineup_profiles
                .iter()
                .map(|row| {
                    vec![
                        row.label.clone(),
                        row.player.clone(),
                        row.heroes.clone(),
                        row.source.clone(),
                        row.confidence.clone(),
                    ]
                })
                .collect(),
        )?;

        self.record_export_job(
            "lineup_library",
            "csv",
            "workspace-lineup-library",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "lineup_library",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_battle_report_html(
        &self,
        workspace_id: Option<i64>,
        battle_code: &str,
    ) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let (battle, lineup_profiles) = {
            let connection = self.conn();
            let battle = query_battle_report_by_code(&connection, battle_code, workspace_id)?
                .ok_or_else(|| {
                    AppError::Message(format!("battle report {battle_code} was not found"))
                })?;
            let lineup_profiles =
                query_lineup_profiles_for_battle_code(&connection, battle_code, workspace_id)?;
            (battle, lineup_profiles)
        };
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let safe_code = sanitize_filename_component(battle_code);
        let path = exports_dir.join(format!("battle-report-{safe_code}-{stamp}.html"));
        let body = format!(
            "{}{}{}",
            html_metric_grid(&[
                ("战报码", battle.battle_code.clone()),
                ("对战玩家", battle.enemy_player.clone()),
                ("敌对同盟", battle.enemy.clone()),
                ("结果", battle.result.clone()),
                ("回合", battle.round.to_string()),
                ("地点", battle.location.clone()),
            ]),
            html_table_section(
                "战报详情",
                &["time", "battleId", "lineup"],
                vec![vec![
                    battle.time.clone(),
                    battle.battle_id.clone(),
                    battle.lineup.clone(),
                ]],
            ),
            html_table_section(
                "固定阵容候选",
                &["label", "player", "heroes", "source", "confidence"],
                lineup_profiles
                    .iter()
                    .map(|row| {
                        vec![
                            row.label.clone(),
                            row.player.clone(),
                            row.heroes.clone(),
                            row.source.clone(),
                            row.confidence.clone(),
                        ]
                    })
                    .collect(),
            ),
        );
        let env_block = html_section(
            "战场环境 JSON",
            &html_pre_block(&battle.battlefield_environment_json),
        );
        fs::write(&path, html_document("单战报导出", &(body + &env_block)))?;
        self.record_export_job(
            "battle_report",
            "html",
            battle_code,
            std::slice::from_ref(&path),
            serde_json::json!({
                "battleCode": battle_code,
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_battle_report_json(
        &self,
        workspace_id: Option<i64>,
        battle_code: &str,
    ) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let (battle, lineup_profiles) = {
            let connection = self.conn();
            let battle = query_battle_report_by_code(&connection, battle_code, workspace_id)?
                .ok_or_else(|| {
                    AppError::Message(format!("battle report {battle_code} was not found"))
                })?;
            let lineup_profiles =
                query_lineup_profiles_for_battle_code(&connection, battle_code, workspace_id)?;
            (battle, lineup_profiles)
        };
        let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
        let safe_code = sanitize_filename_component(battle_code);
        let path = exports_dir.join(format!("battle-report-{safe_code}-{stamp}.json"));
        let payload = serde_json::json!({
            "battleCode": battle_code,
            "battleReport": battle,
            "fixedLineupCandidates": lineup_profiles,
            "generatedAt": Local::now().to_rfc3339()
        });
        fs::write(&path, serde_json::to_vec_pretty(&payload)?)?;
        self.record_export_job(
            "battle_report",
            "json",
            battle_code,
            std::slice::from_ref(&path),
            serde_json::json!({
                "battleCode": battle_code,
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    pub fn export_alliance_member_data_csv(&self, workspace_id: Option<i64>) -> AppResult<PathBuf> {
        let exports_dir = self.export_root();
        fs::create_dir_all(&exports_dir)?;
        let (alliance_name, members) = {
            let connection = self.conn();
            let alliance_name = if let Some(workspace_id) = workspace_id {
                connection
                    .query_row(
                        "SELECT name FROM alliance WHERE workspace_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT 1",
                        params![workspace_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .unwrap_or_default()
            } else {
                connection
                    .query_row(
                        "SELECT name FROM alliance ORDER BY updated_at DESC, id DESC LIMIT 1",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .unwrap_or_default()
            };
            // 成员数据 CSV 不输出 raw_json，走紧凑路径即可。
            // P1-8：改用「每成员最新一条快照」，避免同一成员按历次采集重复多行。
        let members = query_latest_member_snapshots(&connection, workspace_id, false)?;
            (alliance_name, members)
        };

        let stamp = Utc::now().format("%Y年%m月%d日%H时%M分%S秒").to_string();
        let exported_at = Utc::now().format("%m月%d日%H时%M分%S秒").to_string();
        let alliance_label = sanitize_filename_component(&alliance_name);
        let path = exports_dir.join(format!(
            "{alliance_label}{stamp}游戏内同盟成员数据_(导出于{exported_at}).csv"
        ));

        let rows = members
            .into_iter()
            .map(|row| {
                let stats = parse_weekly_statistics(&row.weekly_statistics_json);
                let attack = weekly_stat_number(stats.as_ref(), "attack");
                let demolition_value = if row.demolition_value != 0 {
                    row.demolition_value
                } else {
                    weekly_stat_number(stats.as_ref(), "demolish")
                };
                let wipe_out = weekly_stat_number(stats.as_ref(), "wipeOut");
                let occupy = weekly_stat_number(stats.as_ref(), "occupy");
                let kill_num = weekly_stat_number(stats.as_ref(), "killNum");
                let siege = weekly_stat_number(stats.as_ref(), "seige");
                let history_feat = row.t_feat.max(weekly_stat_number(stats.as_ref(), "feat"));
                let ratio = if row.prosperity > 0 {
                    format!("{:.2}", row.weekly_merit as f64 / row.prosperity as f64)
                } else {
                    "0.00".to_string()
                };
                let group_name = if row.legion_name.trim().is_empty() {
                    "未分组".to_string()
                } else {
                    row.legion_name.clone()
                };
                let coord = if row.coordinate_x != 0 || row.coordinate_y != 0 {
                    format!("{}, {}", row.coordinate_x, row.coordinate_y)
                } else {
                    String::new()
                };
                vec![
                    row.avatar_name,
                    row.avatar_id,
                    group_name,
                    row.profession_name,
                    row.prosperity.to_string(),
                    ratio,
                    row.weekly_merit.to_string(),
                    attack.to_string(),
                    demolition_value.to_string(),
                    wipe_out.to_string(),
                    occupy.to_string(),
                    kill_num.to_string(),
                    siege.to_string(),
                    row.weekly_contribution.to_string(),
                    history_feat.to_string(),
                    coord,
                    format_join_time(row.join_ts),
                ]
            })
            .collect();

        write_csv(
            &path,
            &[
                "成员",
                "游戏编号",
                "分组",
                "职业",
                "繁荣",
                "武勋/繁荣",
                "本周武勋",
                "本周翻地",
                "本周拆迁值",
                "本周击溃",
                "本周攻城次数",
                "本周攻城杀敌",
                "本周攻城值",
                "本周贡献",
                "历史武勋",
                "主城坐标",
                "入盟时间",
            ],
            rows,
        )?;

        self.record_export_job(
            "alliance_member_data",
            "csv",
            "game-alliance-member-data",
            std::slice::from_ref(&path),
            serde_json::json!({
                "kind": "alliance_member_data",
                "workspaceId": workspace_id
            }),
        )?;
        Ok(path)
    }

    fn ensure_export_bundle_xlsx_helper(&self) -> AppResult<PathBuf> {
        let helper_path = self.app_data_dir.join("export_bundle_xlsx.py");
        write_text_if_changed(
            &helper_path,
            include_str!("../../../collector/export_bundle_xlsx.py"),
        )?;
        Ok(helper_path)
    }

    fn run_python_helper(
        &self,
        script_path: &std::path::Path,
        output_path: &std::path::Path,
        stdin_bytes: &[u8],
    ) -> AppResult<()> {
        let candidates = [("python", Vec::<&str>::new()), ("py", vec!["-3"])];
        let mut last_error: Option<std::io::Error> = None;

        for (program, prefix) in candidates {
            let mut command = Command::new(program);
            command.args(prefix.iter().copied());
            command.arg(script_path);
            command.arg(output_path);
            command.stdin(Stdio::piped());
            command.stdout(Stdio::piped());
            command.stderr(Stdio::piped());
            hide_subprocess_window(&mut command);

            match command.spawn() {
                Ok(mut child) => {
                    // stdin 写完后立即 drop：管道容量有限，大数据量 bundle 若一直
                    // 持有 stdin 会与子进程形成死锁。
                    let stdin = child.stdin.take().ok_or_else(|| {
                        AppError::Message("无法打开 Python 导出脚本的输入管道".to_string())
                    })?;
                    let child_id = child.id();
                    if let Err(error) = write_all_then_drop(stdin, stdin_bytes) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(AppError::Message(format!(
                            "向 Python 导出脚本写入数据失败：{error}"
                        )));
                    }

                    // 60 秒硬超时：超时则杀掉进程树，避免脚本挂起时冻结整个应用。
                    let deadline = Instant::now() + Duration::from_secs(60);
                    let mut killed = false;
                    let output = loop {
                        match child.try_wait() {
                            Ok(Some(_status)) => break child.wait_with_output()?,
                            Ok(None) => {
                                if Instant::now() >= deadline {
                                    kill_process_tree(child_id);
                                    let _ = child.kill();
                                    killed = true;
                                    break child.wait_with_output()?;
                                }
                                std::thread::sleep(Duration::from_millis(100));
                            }
                            Err(error) => return Err(AppError::from(error)),
                        }
                    };

                    if killed {
                        return Err(AppError::Message(
                            "XLSX 导出超时（超过 60 秒），已终止 Python 脚本，请重试".to_string(),
                        ));
                    }

                    if output.status.success() {
                        return Ok(());
                    }

                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let detail = match (stderr.is_empty(), stdout.is_empty()) {
                        (false, false) => format!("{stderr}; stdout: {stdout}"),
                        (false, true) => stderr,
                        (true, false) => format!("stdout: {stdout}"),
                        (true, true) => "Python 导出脚本异常退出".to_string(),
                    };
                    return Err(AppError::Message(format!("XLSX 导出失败：{detail}")));
                }
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }

        // 两个候选解释器都因“找不到可执行文件”失败时，给出可直接展示的中文提示；
        // 其它启动错误（权限、路径非法等）保留原始错误详情。
        let python_missing = last_error
            .as_ref()
            .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound);
        if python_missing {
            return Err(AppError::Message(
                "XLSX 导出需要安装 Python，请安装后重试或改用其它格式".to_string(),
            ));
        }

        Err(AppError::Message(format!(
            "无法启动 Python 导出脚本：{}",
            last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "未知启动错误".to_string())
        )))
    }

    fn record_export_job(
        &self,
        job_kind: &str,
        format: &str,
        target: &str,
        output_paths: &[PathBuf],
        request_json: serde_json::Value,
    ) -> AppResult<()> {
        let connection = self.conn();
        let workspace_id = request_json.get("workspaceId").and_then(Value::as_i64);
        connection.execute(
            "INSERT INTO export_job
              (workspace_id, created_at, job_kind, format, target, status, output_paths_json, request_json)
             VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, ?7)",
            params![
                workspace_id,
                Local::now().to_rfc3339(),
                job_kind,
                format,
                target,
                serde_json::to_string(
                    &output_paths
                        .iter()
                        .map(|path| path.to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                )?,
                request_json.to_string()
            ],
        )?;
        Ok(())
    }
}

/// 写完 stdin 后立即 drop 句柄（向子进程发送 EOF）。单独成函数是为了确保
/// 无论写入成功与否，stdin 都会在继续等待子进程之前被关闭。
fn write_all_then_drop(mut stdin: std::process::ChildStdin, bytes: &[u8]) -> std::io::Result<()> {
    stdin.write_all(bytes)
}

pub(super) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn html_document(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #dbe3ea;
      --accent: #0f766e;
    }}
    body {{
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--ink);
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .wrap {{ max-width: 1440px; margin: 0 auto; }}
    h1 {{ margin: 0 0 8px; font-size: 28px; }}
    .subtitle {{ margin: 0 0 20px; color: var(--muted); }}
    .metric-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }}
    .metric-card, .section {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }}
    .metric-card {{ padding: 12px 14px; }}
    .metric-card span {{ display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }}
    .metric-card strong {{ font-size: 18px; }}
    .section {{ padding: 14px; margin-bottom: 16px; overflow: hidden; }}
    .section h2 {{ margin: 0 0 12px; font-size: 18px; }}
    .table-wrap {{ overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{
      border-top: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }}
    th {{
      border-top: none;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }}
    tr:nth-child(even) td {{ background: #fafbfc; }}
    .empty {{ color: var(--muted); }}
    pre {{
      margin: 0;
      padding: 12px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }}
    .kv {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    .kv div {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      background: #fbfcfd;
    }}
    .kv span {{ display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }}
    .kv strong {{ font-size: 14px; }}
    .accent {{ color: var(--accent); }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>{title}</h1>
    <p class="subtitle">导出报表</p>
{body}
  </div>
</body>
</html>"#,
        title = escape_html(title),
        body = body
    )
}

pub(super) fn html_metric_grid(items: &[(&str, String)]) -> String {
    let mut output = String::from("<section class=\"metric-grid\">");
    for (label, value) in items {
        output.push_str(&format!(
            "<div class=\"metric-card\"><span>{}</span><strong>{}</strong></div>",
            escape_html(label),
            escape_html(value)
        ));
    }
    output.push_str("</section>");
    output
}

pub(super) fn html_section(title: &str, content: &str) -> String {
    format!(
        "<section class=\"section\"><h2>{}</h2>{}</section>",
        escape_html(title),
        content
    )
}

pub(super) fn html_pre_block(value: &str) -> String {
    format!("<pre>{}</pre>", escape_html(value))
}

pub(super) fn html_table_section(title: &str, headers: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut output = format!("<section class=\"section\"><h2>{}</h2>", escape_html(title));
    output.push_str("<div class=\"table-wrap\"><table><thead><tr>");
    for header in headers {
        output.push_str(&format!("<th>{}</th>", escape_html(header)));
    }
    output.push_str("</tr></thead><tbody>");
    if rows.is_empty() {
        output.push_str(&format!(
            "<tr><td class=\"empty\" colspan=\"{}\">暂无数据</td></tr>",
            headers.len()
        ));
    } else {
        for row in rows {
            output.push_str("<tr>");
            for cell in row {
                output.push_str(&format!("<td>{}</td>", escape_html(&cell)));
            }
            output.push_str("</tr>");
        }
    }
    output.push_str("</tbody></table></div></section>");
    output
}

pub(super) fn write_csv(path: &PathBuf, headers: &[&str], rows: Vec<Vec<String>>) -> AppResult<()> {
    let mut file = fs::File::create(path)?;
    file.write_all("\u{feff}".as_bytes())?;
    file.write_all(headers.join(",").as_bytes())?;
    file.write_all(b"\r\n")?;
    for row in rows {
        let line = row
            .into_iter()
            .map(|cell| csv_cell(&cell))
            .collect::<Vec<_>>()
            .join(",");
        file.write_all(line.as_bytes())?;
        file.write_all(b"\r\n")?;
    }
    Ok(())
}

pub(super) fn csv_cell(value: &str) -> String {
    let guarded: std::borrow::Cow<'_, str> = match value.chars().next() {
        Some('=') | Some('+') | Some('@') | Some('\t') | Some('\r') | Some('\n') => {
            std::borrow::Cow::Owned(format!("'{value}"))
        }
        Some('-') if !value[1..].starts_with(|ch: char| ch.is_ascii_digit()) => {
            std::borrow::Cow::Owned(format!("'{value}"))
        }
        _ => std::borrow::Cow::Borrowed(value),
    };
    let needs_quotes = guarded
        .contains(',')
        || guarded.contains('"')
        || guarded.contains('\n')
        || guarded.contains('\r');
    let escaped = guarded.replace('"', "\"\"");
    if needs_quotes {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}
