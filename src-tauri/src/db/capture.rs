use crate::error::{AppError, AppResult};
use crate::models::{
    CaptureManifestArtifactSummary, CapturePreviewCounts, CaptureSessionCapture,
    CaptureSessionSummaryRecord, CollectorCaptureAck, CollectorCapturePayload, StartCaptureRequest,
    StartCaptureResponse,
};
use chrono::{Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;

use super::helpers::safe_path_component;
use super::query::{resolve_alliance_context, upsert_player};
use super::Database;

struct CaptureLifecycleArtifactRequest<'a> {
    connection: &'a Connection,
    capture_session_id: i64,
    capture_type: &'a str,
    status: &'a str,
    note: &'a str,
    captured_at: &'a str,
    summary: &'a Value,
}

struct NormalizePreviewContext<'a> {
    connection: &'a Connection,
    session_id: i64,
    workspace_id: i64,
    alliance_id: Option<i64>,
    raw_artifact_id: i64,
    collector_ack: Option<&'a CollectorCaptureAck>,
    captured_at: &'a str,
}

impl Database {
    fn default_capture_payload(capture_type: &str) -> CollectorCapturePayload {
        CollectorCapturePayload::default_for_capture_type(capture_type)
    }

    fn validate_capture_type(capture_type: &str) -> AppResult<()> {
        match capture_type {
            "alliance_data" | "battle_passive" => Ok(()),
            other => Err(AppError::Message(format!("unknown capture type: {other}"))),
        }
    }

    fn record_capture_manifest_artifact(
        &self,
        connection: &Connection,
        capture_session_id: i64,
        capture_type: &str,
        collector_ack: &CollectorCaptureAck,
        captured_at: &str,
    ) -> AppResult<(i64, String, String)> {
        let raw_dir = self.app_data_dir.join("raw").join("capture-manifests");
        fs::create_dir_all(&raw_dir)?;

        let safe_capture_type = safe_path_component(capture_type);
        let file_name = format!(
            "capture-manifest-{capture_session_id}-{safe_capture_type}-{}.json",
            Utc::now().format("%Y%m%d-%H%M%S-%3f")
        );
        let relative_path = format!("raw/capture-manifests/{file_name}");
        let absolute_path = raw_dir.join(&file_name);
        let manifest_payload = serde_json::json!({
            "captureSessionId": capture_session_id,
            "captureType": capture_type,
            "status": collector_ack.status.clone(),
            "message": collector_ack.message.clone(),
            "sessionId": collector_ack.session_id.clone(),
            "capturedAt": captured_at,
            "collectorPayload": collector_ack.payload.clone(),
        });
        let manifest_bytes = serde_json::to_vec_pretty(&manifest_payload)?;
        fs::write(&absolute_path, &manifest_bytes)?;
        let sensitive_scan_status =
            Self::sensitive_scan_status_for_payload(collector_ack.payload.as_ref());

        let mut hasher = Sha256::new();
        hasher.update(&manifest_bytes);
        let sha256 = format!("{:x}", hasher.finalize());

        connection.execute(
            "INSERT INTO raw_artifact
              (capture_session_id, path, artifact_type, source_module, source_func, captured_at,
               sha256, sensitive_scan_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                capture_session_id,
                relative_path,
                "capture_manifest",
                Some("collector_sidecar"),
                Some("capture_started"),
                captured_at,
                sha256.as_str(),
                sensitive_scan_status,
            ],
        )?;

        let raw_artifact_id = connection.last_insert_rowid();
        Ok((raw_artifact_id, relative_path, sha256))
    }

    fn record_capture_lifecycle_artifact(
        &self,
        request: CaptureLifecycleArtifactRequest<'_>,
    ) -> AppResult<(i64, String, String)> {
        let CaptureLifecycleArtifactRequest {
            connection,
            capture_session_id,
            capture_type,
            status,
            note,
            captured_at,
            summary,
        } = request;
        let raw_dir = self.app_data_dir.join("raw").join("capture-manifests");
        fs::create_dir_all(&raw_dir)?;
        let safe_capture_type = safe_path_component(capture_type);
        let safe_status = safe_path_component(status);
        let file_name = format!(
            "capture-lifecycle-{capture_session_id}-{safe_capture_type}-{safe_status}-{}.json",
            Utc::now().format("%Y%m%d-%H%M%S-%3f")
        );
        let relative_path = format!("raw/capture-manifests/{file_name}");
        let absolute_path = raw_dir.join(&file_name);
        let artifact_payload = serde_json::json!({
            "captureSessionId": capture_session_id,
            "captureType": capture_type,
            "status": status,
            "message": note,
            "capturedAt": captured_at,
            "summary": summary,
        });
        let artifact_bytes = serde_json::to_vec_pretty(&artifact_payload)?;
        fs::write(&absolute_path, &artifact_bytes)?;

        let mut hasher = Sha256::new();
        hasher.update(&artifact_bytes);
        let sha256 = format!("{:x}", hasher.finalize());
        let sensitive_scan_status =
            Self::sensitive_scan_status_for_payload(Some(&artifact_payload));

        connection.execute(
            "INSERT INTO raw_artifact
              (capture_session_id, path, artifact_type, source_module, source_func, captured_at,
               sha256, sensitive_scan_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                capture_session_id,
                relative_path,
                "capture_lifecycle",
                "collector_sidecar",
                status,
                captured_at,
                sha256.as_str(),
                sensitive_scan_status,
            ],
        )?;

        Ok((connection.last_insert_rowid(), relative_path, sha256))
    }

    fn record_runtime_evidence_artifacts(
        &self,
        connection: &Connection,
        capture_session_id: i64,
        capture_type: &str,
        collector_ack: &CollectorCaptureAck,
        captured_at: &str,
    ) -> AppResult<Vec<(i64, String, String, String)>> {
        let Some(artifacts) = collector_ack
            .payload
            .as_ref()
            .and_then(Self::extract_capture_evidence_artifacts)
        else {
            return Ok(Vec::new());
        };
        let raw_dir = self
            .app_data_dir
            .join("raw")
            .join("runtime")
            .join(safe_path_component(capture_type));
        fs::create_dir_all(&raw_dir)?;

        let mut recorded = Vec::new();
        for (index, artifact) in artifacts.iter().enumerate() {
            let artifact_type = artifact
                .get("artifactType")
                .and_then(Value::as_str)
                .unwrap_or("runtime_evidence");
            let safe_artifact_type = safe_path_component(artifact_type);
            let file_name = format!(
                "{capture_session_id}-{safe_artifact_type}-{index}-{}.json",
                Utc::now().format("%Y%m%d-%H%M%S-%3f")
            );
            let relative_path = format!(
                "raw/runtime/{}/{file_name}",
                safe_path_component(capture_type)
            );
            let absolute_path = raw_dir.join(&file_name);
            let artifact_payload = serde_json::json!({
                "captureSessionId": capture_session_id,
                "captureType": capture_type,
                "capturedAt": captured_at,
                "artifact": artifact,
            });
            let artifact_bytes = serde_json::to_vec_pretty(&artifact_payload)?;
            fs::write(&absolute_path, &artifact_bytes)?;
            let mut hasher = Sha256::new();
            hasher.update(&artifact_bytes);
            let sha256 = format!("{:x}", hasher.finalize());
            let sensitive_scan_status = Self::sensitive_scan_status_for_payload(Some(artifact));
            connection.execute(
                "INSERT INTO raw_artifact
                  (capture_session_id, path, artifact_type, source_module, source_func, captured_at,
                   sha256, sensitive_scan_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    capture_session_id,
                    relative_path,
                    artifact_type,
                    artifact
                        .get("source")
                        .and_then(Value::as_str)
                        .unwrap_or("runtime_probe"),
                    collector_ack
                        .payload
                        .as_ref()
                        .and_then(|payload| {
                            payload.get("nextProbe").or_else(|| {
                                payload
                                    .get("collectorPayload")
                                    .and_then(|value| value.get("nextProbe"))
                            })
                        })
                        .and_then(Value::as_str)
                        .unwrap_or("runtime_probe"),
                    captured_at,
                    sha256.as_str(),
                    sensitive_scan_status,
                ],
            )?;
            recorded.push((
                connection.last_insert_rowid(),
                relative_path,
                sha256,
                artifact_type.to_string(),
            ));
        }
        Ok(recorded)
    }

    fn extract_capture_evidence_artifacts(payload: &Value) -> Option<&[Value]> {
        payload
            .get("collectorPayload")
            .and_then(|value| value.get("evidence"))
            .or_else(|| payload.get("evidence"))
            .and_then(|value| value.get("artifacts"))
            .and_then(Value::as_array)
            .map(Vec::as_slice)
    }

    /// 2026-08-08 崩溃修复：从 capture summary 中剥离完整 RPC evidence。
    ///
    /// evidence.artifacts[].records 携带原始 RPC dump（jsonl 记录数组），单次采集可达
    /// 10~26MB；它同时被持久化为独立文件 + raw_artifact 表（record_runtime_evidence_artifacts
    /// 已在其之前落库），summary_json 里的 evidence 是冗余副本。剥离后 summary_json
    /// 仅保留 preview/runtime 精简摘要（KB 级），从源头阻止数据库与前端 IPC 膨胀。
    ///
    /// 兼容两种 evidence 位置（与 extract_capture_evidence_artifacts 同构）：
    /// - CaptureSessionCapture::Typed：capture.collectorPayload.evidence
    /// - CaptureSessionCapture::Raw：capture.evidence
    ///
    /// 输入必须是可变的顶层 summary Value；原地删除 evidence 键。
    fn strip_evidence_from_summary(summary: &mut Value) {
        let Some(capture) = summary.get_mut("capture") else {
            return;
        };
        // Raw 形状：evidence 可能挂在 capture.collectorPayload.evidence
        if capture.is_object() {
            if let Some(map) = capture.as_object_mut() {
                if let Some(Some(payload)) = map
                    .get_mut("collectorPayload")
                    .map(Value::as_object_mut)
                {
                    payload.remove("evidence");
                }
            }
        }
        // Typed（capture 为 CollectorCapturePayload 扁平序列化）与 Raw 顶层：
        // evidence 都位于 capture.evidence
        if capture.is_object() {
            if let Some(map) = capture.as_object_mut() {
                map.remove("evidence");
            }
        }
    }

    /// 序列化 summary 为写入 DB 的 JSON，写入前剥离 evidence（见 strip_evidence_from_summary）。
    fn serialize_summary_json(summary: &CaptureSessionSummaryRecord) -> AppResult<String> {
        let mut value = serde_json::to_value(summary)?;
        Self::strip_evidence_from_summary(&mut value);
        Ok(serde_json::to_string(&value)?)
    }

    fn normalize_capture_preview(
        &self,
        context: NormalizePreviewContext<'_>,
    ) -> AppResult<CapturePreviewCounts> {
        let NormalizePreviewContext {
            connection,
            session_id,
            workspace_id,
            alliance_id,
            raw_artifact_id,
            collector_ack,
            captured_at,
        } = context;
        let Some(preview) = Self::extract_capture_preview(collector_ack) else {
            return Ok(CapturePreviewCounts::default());
        };
        // P2 修复：此前用 `.ok()` 静默吞错——workspace 里还没有 alliance 时
        // preview 会被整体丢弃（counts 全 0）而会话仍记 completed，用户零感知。
        // 这里保留优雅降级（缺 alliance 属正常状态，不该让整次采集失败），
        // 但把原因打到日志，便于事后定位。
        let (resolved_alliance_id, _) =
            match resolve_alliance_context(connection, workspace_id, alliance_id) {
                Ok(resolved) => resolved,
                Err(error) => {
                    eprintln!(
                        "capture preview skipped: workspace {workspace_id} 缺少可用 alliance ({error})，\
                         preview 计数记 0"
                    );
                    return Ok(CapturePreviewCounts::default());
                }
            };

        let mut counts = CapturePreviewCounts::default();

        // 兜底映射：游戏侧偶尔不返回军团名（legionGroups 为空），此时用
        // 本次 preview 的 legionGroups + 最近一次已知的 legion_id -> legion_name
        // 映射补齐，避免前端分组列全显示为空。
        let mut legion_name_fallback: HashMap<i64, String> = HashMap::new();
        {
            // 1) 本次 preview 自带的 legionGroups（同一次采集内先应用）
            if let Some(groups) = Self::preview_items(
                &preview,
                &[
                    "legionGroups",
                    "unionGroups",
                    "groupSnapshots",
                    "union_group",
                ],
            ) {
                for group in groups {
                    let group_legion_id = Self::preview_i64(
                        group,
                        &["legionId", "legion_id", "groupId", "group_id", "group", "id"],
                    );
                    let group_legion_name = Self::preview_string(
                        group,
                        &[
                            "legionName",
                            "legion_name",
                            "groupName",
                            "group_name",
                            "name",
                            "title",
                        ],
                    )
                    .unwrap_or_default();
                    if group_legion_id > 0 && !group_legion_name.trim().is_empty() {
                        legion_name_fallback.insert(group_legion_id, group_legion_name);
                    }
                }
            }
            // 2) union_group 表最近一次成功写入的映射
            let best_group = connection
                .query_row(
                    "SELECT MAX(capture_session_id) FROM union_group
                     WHERE workspace_id = ?1
                       AND legion_name IS NOT NULL AND legion_name != ''",
                    params![workspace_id],
                    |row| row.get::<_, i64>(0),
                )
                .ok();
            if let Some(best) = best_group {
                let mut stmt = connection
                    .prepare(
                        "SELECT legion_id, legion_name FROM union_group
                         WHERE capture_session_id = ?1 AND legion_id > 0
                           AND legion_name IS NOT NULL AND legion_name != ''
                         GROUP BY legion_id",
                    )
                    .map_err(AppError::Database)?;
                let rows = stmt
                    .query_map(params![best], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(AppError::Database)?;
                for row in rows.flatten() {
                    legion_name_fallback.insert(row.0, row.1);
                }
            }
            if legion_name_fallback.is_empty() {
                let mut stmt = connection
                    .prepare(
                        "SELECT legion_id, legion_name FROM member_snapshot
                         WHERE capture_session_id = (SELECT MAX(capture_session_id) FROM member_snapshot
                                                     WHERE workspace_id = ?1 AND legion_name IS NOT NULL AND legion_name != '')
                           AND workspace_id = ?1
                           AND legion_id > 0 AND legion_name IS NOT NULL AND legion_name != ''
                         GROUP BY legion_id",
                    )
                    .map_err(AppError::Database)?;
                let rows = stmt
                    .query_map(params![workspace_id], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(AppError::Database)?;
                for row in rows.flatten() {
                    legion_name_fallback.insert(row.0, row.1);
                }
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &[
                "memberSnapshots",
                "memberSnapshotList",
                "member_snapshot_list",
            ],
        ) {
            for item in items {
                let avatar_id = match Self::preview_string(
                    item,
                    &["avatarId", "avatar_id", "memberId", "id"],
                ) {
                    Some(value) if !value.trim().is_empty() => value,
                    _ => continue,
                };
                let avatar_name =
                    match Self::preview_string(item, &["avatarName", "avatar_name", "name"]) {
                        Some(value) if !value.trim().is_empty() => value,
                        _ => continue,
                    };
                let official_name = Self::preview_string(item, &["officialName", "official_name"])
                    .unwrap_or_default();
                let profession_name = Self::preview_string(
                    item,
                    &[
                        "professionName",
                        "profession_name",
                        "profession",
                        "careerName",
                        "career_name",
                        "career",
                        "occupationName",
                        "occupation_name",
                        "jobName",
                        "job_name",
                    ],
                )
                .unwrap_or_default();
                let legion_name = Self::preview_string(
                    item,
                    &["legionName", "legion_name", "groupName", "group_name"],
                )
                .unwrap_or_default();
                // 兜底：legion_name 为空时用最近已知的 legion_id 映射补齐
                let legion_id_raw = Self::preview_i64(
                    item,
                    &["legionId", "legion_id", "groupId", "group_id", "group"],
                );
                let legion_name = if legion_name.trim().is_empty() && legion_id_raw > 0 {
                    legion_name_fallback
                        .get(&legion_id_raw)
                        .cloned()
                        .unwrap_or_default()
                } else {
                    legion_name
                };
                let is_self = Self::preview_bool(item, &["isSelf", "is_self"]);
                counts.member_snapshots += connection.execute(
                    "INSERT OR IGNORE INTO member_snapshot
                      (capture_session_id, workspace_id, alliance_id, observed_at, avatar_id, avatar_name,
                       state, is_online, official_name, profession_name, profession_id,
                       role_id, legion_name, legion_id, legion_leader,
                       prosperity, weekly_merit, weekly_contribution, season_score, demolition_value,
                       coordinate_x, coordinate_y, last_offline_ts, join_ts, t_feat, t_forage_use,
                       w_forage_use, weekly_statistics_json, is_self, raw_json, raw_artifact_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31)",
                    params![
                        session_id,
                        workspace_id,
                        resolved_alliance_id,
                        Self::preview_string(
                            item,
                            &["observedAt", "observed_at", "capturedAt", "time"],
                        )
                        .unwrap_or_else(|| captured_at.to_string()),
                        avatar_id,
                        avatar_name,
                        Self::preview_string(item, &["state"]).unwrap_or_default(),
                        Self::preview_bool(item, &["isOnline", "is_online"]),
                        official_name,
                        profession_name,
                        Self::preview_i64(
                            item,
                            &[
                                "professionId",
                                "profession_id",
                                "careerId",
                                "career_id",
                                "occupationId",
                                "occupation_id",
                                "jobId",
                                "job_id",
                            ],
                        ),
                        Self::preview_i64(item, &["roleId", "role_id"]),
                        legion_name,
                        legion_id_raw,
                        Self::preview_bool(item, &["legionLeader", "legion_leader"]),
                        Self::preview_i64(item, &["prosperity"]),
                        Self::preview_i64(item, &["weeklyMerit", "weekly_merit"]),
                        Self::preview_i64(item, &["weeklyContribution", "weekly_contribution"]),
                        Self::preview_i64(item, &["seasonScore", "season_score"]),
                        Self::preview_i64(item, &["demolitionValue", "demolition_value"]),
                        Self::preview_i64(item, &["coordinateX", "coordinate_x"]),
                        Self::preview_i64(item, &["coordinateY", "coordinate_y"]),
                        Self::preview_i64(item, &["lastOfflineTs", "last_offline_ts"]),
                        Self::preview_i64(item, &["joinTs", "join_ts"]),
                        Self::preview_i64(item, &["tFeat", "t_feat"]),
                        Self::preview_i64(item, &["tForageUse", "t_forage_use"]),
                        Self::preview_i64(item, &["wForageUse", "w_forage_use"]),
                        Self::preview_json_text(
                            item,
                            &[
                                "weeklyStatistics",
                                "weekly_statistics",
                                "weeklyStaticsticsData",
                            ],
                        )
                        .unwrap_or_else(|| "{}".to_string()),
                        is_self,
                        serde_json::to_string(item)?,
                        Some(raw_artifact_id),
                    ],
                )? as i64;
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &[
                "legionGroups",
                "unionGroups",
                "groupSnapshots",
                "union_group",
            ],
        ) {
            for item in items {
                let group_id = Self::preview_i64(
                    item,
                    &["groupId", "group_id", "group", "id", "legionId", "legion_id"],
                );
                let group_name = Self::preview_string(
                    item,
                    &["groupName", "group_name", "name", "title", "legionName", "legion_name"],
                )
                .unwrap_or_default();
                let legion_id = Self::preview_i64(
                    item,
                    &["legionId", "legion_id", "groupId", "group_id", "group", "id"],
                );
                let legion_name = Self::preview_string(
                    item,
                    &["legionName", "legion_name", "groupName", "group_name", "name", "title"],
                )
                .unwrap_or_default();
                let member_count = Self::preview_i64(
                    item,
                    &[
                        "memberCount",
                        "member_count",
                        "count",
                        "memberNum",
                        "member_num",
                    ],
                );
                if legion_id > 0 && !legion_name.trim().is_empty() {
                    counts.legion_groups += connection.execute(
                        "INSERT OR IGNORE INTO union_group
                          (capture_session_id, workspace_id, alliance_id, group_id, group_name,
                           legion_id, legion_name, member_count, observed_at, raw_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        params![
                            session_id,
                            workspace_id,
                            resolved_alliance_id,
                            if group_id > 0 { group_id } else { legion_id },
                            if group_name.trim().is_empty() {
                                legion_name.clone()
                            } else {
                                group_name
                            },
                            legion_id,
                            legion_name,
                            member_count,
                            Self::preview_string(
                                item,
                                &["observedAt", "observed_at", "capturedAt", "time"],
                            )
                            .unwrap_or_else(|| captured_at.to_string()),
                            serde_json::to_string(item)?,
                        ],
                    )? as i64;
                }
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &[
                "unionLogEvents",
                "unionLogEventList",
                "unionLogs",
                "union_log_event_list",
                "union_logs",
            ],
        ) {
            for item in items {
                let actor_name =
                    match Self::preview_string(item, &["actorName", "actor_name", "actor"]) {
                        Some(value) if !value.trim().is_empty() => value,
                        _ => continue,
                    };
                let text = match Self::preview_string(item, &["text", "message", "content"]) {
                    Some(value) if !value.trim().is_empty() => value,
                    _ => continue,
                };
                counts.union_log_events += connection.execute(
                    "INSERT OR IGNORE INTO union_log_event
                      (capture_session_id, workspace_id, alliance_id, event_time, log_category,
                       log_section, actor_name, target_name, text, raw_event_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        session_id,
                        workspace_id,
                        resolved_alliance_id,
                        Self::preview_string(
                            item,
                            &["eventTime", "event_time", "time", "occurredAt"],
                        )
                        .unwrap_or_else(|| captured_at.to_string()),
                        Self::preview_string(
                            item,
                            &["logCategory", "log_category", "category", "type"],
                        )
                        .unwrap_or_else(|| "preview".to_string()),
                        Self::preview_string(item, &["logSection", "log_section", "section"])
                            .unwrap_or_else(|| "other".to_string()),
                        actor_name,
                        Self::preview_string(item, &["targetName", "target_name"]),
                        text,
                        serde_json::to_string(item)?,
                    ],
                )? as i64;
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &[
                "buildingSnapshots",
                "buildingSnapshotList",
                "building_snapshot_list",
            ],
        ) {
            for item in items {
                let building_name =
                    match Self::preview_string(item, &["buildingName", "building_name", "name"]) {
                        Some(value) if !value.trim().is_empty() => value,
                        _ => continue,
                    };
                counts.building_snapshots += connection.execute(
                    "INSERT OR IGNORE INTO building_snapshot
                      (capture_session_id, workspace_id, alliance_id, observed_at, building_name,
                       facility_type, facility_type_id, role_facility_type, cfg_id, carrier_id,
                       level, state, status_id, coordinate_x, coordinate_y, operator_avatar_id,
                       operator_name, benefit, mine_count, max_mine_count, effect, raw_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
                    params![
                        session_id,
                        workspace_id,
                        resolved_alliance_id,
                        Self::preview_string(
                            item,
                            &["observedAt", "observed_at", "capturedAt", "time"],
                        )
                        .unwrap_or_else(|| captured_at.to_string()),
                        building_name,
                        Self::preview_string(item, &["facilityType", "facility_type"])
                            .unwrap_or_default(),
                        Self::preview_i64(item, &["facilityTypeId", "facility_type_id"]),
                        Self::preview_i64(item, &["roleFacilityType", "role_facility_type"]),
                        Self::preview_i64(item, &["cfgId", "cfg_id"]),
                        Self::preview_string(item, &["carrierId", "carrier_id"]).unwrap_or_default(),
                        Self::preview_string(item, &["level"]).unwrap_or_default(),
                        Self::preview_string(item, &["state"]).unwrap_or_default(),
                        Self::preview_i64(item, &["statusId", "status_id"]),
                        Self::preview_i64(item, &["coordinateX", "coordinate_x"]),
                        Self::preview_i64(item, &["coordinateY", "coordinate_y"]),
                        Self::preview_string(item, &["operatorAvatarId", "operator_avatar_id"])
                            .unwrap_or_default(),
                        Self::preview_string(item, &["operatorName", "operator_name"])
                            .unwrap_or_default(),
                        Self::preview_i64(item, &["benefit"]),
                        Self::preview_i64(item, &["mineCount", "mine_count"]),
                        Self::preview_i64(item, &["maxMineCount", "max_mine_count"]),
                        Self::preview_string(item, &["effect"]).unwrap_or_default(),
                        serde_json::to_string(item)?,
                    ],
                )? as i64;
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &["battleBlocks", "battleBlockList", "battle_block_list"],
        ) {
            for (record_index, item) in items.iter().enumerate() {
                let battle_code =
                    match Self::preview_string(item, &["battleCode", "battle_code", "code"]) {
                        Some(value) if !value.trim().is_empty() => value,
                        _ => continue,
                    };
                counts.battle_blocks += connection.execute(
                    "INSERT OR IGNORE INTO battle_block
                      (capture_session_id, workspace_id, alliance_id, battle_id, battle_code, record_index,
                       occurred_at, location, match_type, end_round, result, winner_side, attacker_json,
                       defender_json, battlefield_environment_json, raw_artifact_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                    params![
                        session_id,
                        workspace_id,
                        resolved_alliance_id,
                        Self::preview_string(item, &["battleId", "battle_id"]),
                        battle_code,
                        Self::preview_i64(item, &["recordIndex", "record_index"])
                            .max(record_index as i64),
                        Self::preview_string(
                            item,
                            &["occurredAt", "occurred_at", "time", "capturedAt"],
                        )
                        .unwrap_or_else(|| captured_at.to_string()),
                        Self::preview_string(item, &["location"]).unwrap_or_default(),
                        Self::preview_i64(item, &["matchType", "match_type"]),
                        Self::preview_i64(item, &["endRound", "end_round"]),
                        Self::preview_string(item, &["result"]).unwrap_or_default(),
                        Self::preview_string(item, &["winnerSide", "winner_side"])
                            .unwrap_or_default(),
                        Self::preview_json_text(item, &["attackerJson", "attacker_json", "attacker"])
                            .unwrap_or_else(|| "{}".to_string()),
                        Self::preview_json_text(item, &["defenderJson", "defender_json", "defender"])
                            .unwrap_or_else(|| "{}".to_string()),
                        Self::preview_json_text(
                            item,
                            &[
                                "battlefieldEnvironmentJson",
                                "battlefield_environment_json",
                                "environment",
                            ],
                        )
                        .unwrap_or_else(|| "{}".to_string()),
                        Some(raw_artifact_id),
                    ],
                )? as i64;
            }
        }

        if let Some(items) = Self::preview_items(
            &preview,
            &["lineupProfiles", "lineupProfileList", "lineup_profile_list"],
        ) {
            for item in items {
                let label = match Self::preview_string(item, &["label", "name"]) {
                    Some(value) if !value.trim().is_empty() => value,
                    _ => continue,
                };
                let heroes =
                    match Self::preview_strings(item, &["heroes", "heroesJson", "heroes_json"]) {
                        Some(values) if !values.is_empty() => values,
                        _ => continue,
                    };
                let side =
                    Self::preview_string(item, &["side"]).unwrap_or_else(|| "enemy".to_string());
                let heroes_display = heroes.join(" / ");
                let lineup_fingerprint = format!("{}|{}", side, heroes_display);
                let source_battle_id = Self::preview_string(
                    item,
                    &[
                        "sourceBattleId",
                        "source_battle_id",
                        "battleCode",
                        "battle_code",
                    ],
                );
                let player_name = Self::preview_string(
                    item,
                    &["playerName", "player_name", "avatarName", "avatar_name"],
                );
                let confidence = Self::preview_string(item, &["confidence"])
                    .unwrap_or_else(|| "preview".to_string());
                let notes = Self::preview_string(item, &["notes"]);
                let player_avatar_id =
                    Self::preview_string(item, &["playerAvatarId", "player_avatar_id"]);
                let player_id = player_name.as_deref().map(|name| {
                    upsert_player(connection, player_avatar_id.as_deref(), name, captured_at)
                });
                let player_id = match player_id {
                    Some(Ok(player_id)) => Some(player_id),
                    Some(Err(error)) => return Err(error),
                    None => None,
                };
                counts.lineup_profiles += connection.execute(
                    "INSERT OR IGNORE INTO lineup_profile
                      (workspace_id, alliance_id, player_id, side, lineup_fingerprint, label, heroes_json,
                       source_battle_id, confidence, valid_from, valid_to, notes, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?10, ?10)",
                    params![
                        workspace_id,
                        Some(resolved_alliance_id),
                        player_id,
                        side,
                        lineup_fingerprint,
                        label,
                        serde_json::to_string(&heroes)?,
                        source_battle_id,
                        confidence,
                        captured_at,
                        notes,
                    ],
                )? as i64;
            }
        }

        // ── 同盟情报（新增域）：排行榜 / 武将红度普查 / 赛季战队 / 主公簿 / 同盟建筑 / 同盟历史 ──
        //
        // 解析完全在 collector 侧（flows/alliance_intel.py）完成，这里只做落库，
        // 保证"协议变化时只改 Python + 重放原始载荷"的路径不被 Rust 结构体锁死。
        if let Some(items) = Self::preview_items(
            &preview,
            &["intelSnapshots", "intelSnapshotList", "intel_snapshot_list"],
        ) {
            for item in items {
                let kind = Self::preview_string(item, &["kind"]).unwrap_or_default();
                if kind.trim().is_empty() {
                    continue;
                }
                let subject_key =
                    Self::preview_string(item, &["subjectKey", "subject_key"]).unwrap_or_default();
                let subject_label =
                    Self::preview_string(item, &["subjectLabel", "subject_label"]).unwrap_or_default();
                let observed_at = Self::preview_string(item, &["observedAt", "observed_at"])
                    .unwrap_or_else(|| captured_at.to_string());
                let source_func =
                    Self::preview_string(item, &["sourceFunc", "source_func"]).unwrap_or_default();
                let metrics_json =
                    Self::preview_json_text(item, &["metrics"]).unwrap_or_else(|| "{}".to_string());
                let payload_json =
                    Self::preview_json_text(item, &["payload"]).unwrap_or_else(|| "{}".to_string());
                let entries = item
                    .get("entries")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                counts.intel_snapshots += connection.execute(
                    "INSERT OR IGNORE INTO alliance_intel_snapshot
                      (workspace_id, capture_session_id, alliance_id, kind, subject_key, subject_label,
                       observed_at, entry_count, metrics_json, payload_json, source_func)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        workspace_id,
                        session_id,
                        Some(resolved_alliance_id),
                        kind,
                        subject_key,
                        subject_label,
                        observed_at,
                        entries.len() as i64,
                        metrics_json,
                        payload_json,
                        source_func,
                    ],
                )? as i64;
                // 条目要用 snapshot_id 关联。INSERT OR IGNORE 在命中 UNIQUE 时不会更新
                // last_insert_rowid，所以按 UNIQUE 键回查而不是取 last_insert_rowid。
                let snapshot_id: Option<i64> = connection
                    .query_row(
                        "SELECT id FROM alliance_intel_snapshot
                         WHERE workspace_id = ?1 AND kind = ?2 AND subject_key = ?3 AND observed_at = ?4",
                        params![workspace_id, kind, subject_key, observed_at],
                        |row| row.get(0),
                    )
                    .optional()?;
                let Some(snapshot_id) = snapshot_id else {
                    continue;
                };
                for entry in entries {
                    let subject =
                        Self::preview_string(&entry, &["subjectKey", "subject_key"]).unwrap_or_default();
                    let value = entry
                        .get("value")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    counts.intel_entries += connection.execute(
                        "INSERT INTO alliance_intel_entry
                          (snapshot_id, workspace_id, kind, rank, subject_key, name, union_name, value, extra_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            snapshot_id,
                            workspace_id,
                            kind,
                            Self::preview_i64(&entry, &["rank"]),
                            subject,
                            Self::preview_string(&entry, &["name"]).unwrap_or_default(),
                            Self::preview_string(&entry, &["unionName", "union_name"])
                                .unwrap_or_default(),
                            value,
                            Self::preview_json_text(&entry, &["extra"])
                                .unwrap_or_else(|| "{}".to_string()),
                        ],
                    )? as i64;
                }
            }
        }

        Ok(counts)
    }
    fn extract_capture_preview(collector_ack: Option<&CollectorCaptureAck>) -> Option<Value> {
        if let Some(preview) = collector_ack
            .and_then(|ack| ack.capture_result())
            .and_then(|result| result.preview().cloned())
            .filter(Self::has_preview_sections)
        {
            return Some(preview);
        }

        let payload = collector_ack?.payload.as_ref()?;
        if let Some(preview) = payload
            .get("collectorPayload")
            .and_then(|value| value.get("preview"))
            .cloned()
            .filter(Self::has_preview_sections)
        {
            return Some(preview);
        }
        if let Some(preview) = payload
            .get("preview")
            .cloned()
            .filter(Self::has_preview_sections)
        {
            return Some(preview);
        }
        if Self::has_preview_sections(payload) {
            return Some(payload.clone());
        }
        None
    }

    fn has_preview_sections(value: &Value) -> bool {
        [
            [
                "memberSnapshots",
                "memberSnapshotList",
                "member_snapshot_list",
            ]
            .as_slice(),
            ["legionGroups", "unionGroups", "groupSnapshots", "union_group"].as_slice(),
            [
                "unionLogEvents",
                "unionLogEventList",
                "union_log_event_list",
            ]
            .as_slice(),
            [
                "buildingSnapshots",
                "buildingSnapshotList",
                "building_snapshot_list",
            ]
            .as_slice(),
            ["battleBlocks", "battleBlockList", "battle_block_list"].as_slice(),
            ["lineupProfiles", "lineupProfileList", "lineup_profile_list"].as_slice(),
            // 同盟情报：只有这一节时也必须能落库，否则整段 preview 会被静默丢弃
            ["intelSnapshots", "intelSnapshotList", "intel_snapshot_list"].as_slice(),
        ]
        .iter()
        .any(|keys| Self::preview_items(value, keys).is_some())
    }

    fn preview_items<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a [Value]> {
        for key in keys {
            let Some(section) = value.get(*key) else {
                continue;
            };
            if let Some(items) = section.as_array() {
                return Some(items);
            }
            if let Some(items) = section.get("rows").and_then(Value::as_array) {
                return Some(items);
            }
            if let Some(items) = section.get("items").and_then(Value::as_array) {
                return Some(items);
            }
            if let Some(items) = section.get("list").and_then(Value::as_array) {
                return Some(items);
            }
        }
        None
    }

    fn preview_string(value: &Value, keys: &[&str]) -> Option<String> {
        for key in keys {
            if let Some(value) = value.get(*key) {
                if let Some(text) = Self::value_as_string(value) {
                    return Some(text);
                }
            }
        }
        None
    }

    fn preview_strings(value: &Value, keys: &[&str]) -> Option<Vec<String>> {
        for key in keys {
            if let Some(value) = value.get(*key) {
                if let Some(items) = value.as_array() {
                    let values = items
                        .iter()
                        .filter_map(Self::value_as_string)
                        .collect::<Vec<_>>();
                    if !values.is_empty() {
                        return Some(values);
                    }
                }
                if let Some(text) = Self::value_as_string(value) {
                    let values = text
                        .split('/')
                        .map(|part| part.trim().to_string())
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>();
                    if !values.is_empty() {
                        return Some(values);
                    }
                }
            }
        }
        None
    }

    fn preview_json_text(value: &Value, keys: &[&str]) -> Option<String> {
        for key in keys {
            if let Some(value) = value.get(*key) {
                if let Some(text) = value.as_str() {
                    return Some(text.to_string());
                }
                if !value.is_null() {
                    return serde_json::to_string(value).ok();
                }
            }
        }
        None
    }

    fn preview_bool(value: &Value, keys: &[&str]) -> i64 {
        for key in keys {
            if let Some(value) = value.get(*key) {
                if let Some(flag) = value.as_bool() {
                    return i64::from(flag);
                }
                if let Some(text) = value.as_str() {
                    return i64::from(matches!(text.to_lowercase().as_str(), "true" | "1" | "yes"));
                }
            }
        }
        0
    }

    fn preview_i64(value: &Value, keys: &[&str]) -> i64 {
        for key in keys {
            if let Some(value) = value.get(*key) {
                if let Some(number) = value.as_i64() {
                    return number;
                }
                if let Some(text) = value.as_str() {
                    if let Ok(number) = text.parse::<i64>() {
                        return number;
                    }
                }
            }
        }
        0
    }

    fn value_as_string(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(flag) => Some(flag.to_string()),
            _ => None,
        }
    }

    pub(super) fn sensitive_scan_status_for_payload(payload: Option<&Value>) -> &'static str {
        fn is_sensitive_key(key: &str) -> bool {
            let lower = key.to_ascii_lowercase();
            [
                "token",
                "secret",
                "password",
                "passwd",
                "credential",
                "credentials",
                "cookie",
                "authorization",
                "auth",
                "csrf",
                "bearer",
                "access_token",
                "refresh_token",
                "密钥",
                "密码",
                "口令",
                "凭证",
                "授权",
            ]
            .iter()
            .any(|needle| lower.contains(needle))
        }

        fn walk(value: &Value, key_hint: Option<&str>) -> bool {
            match value {
                Value::Object(map) => map
                    .iter()
                    .any(|(key, child)| is_sensitive_key(key) || walk(child, Some(key))),
                Value::Array(items) => items.iter().any(|item| walk(item, key_hint)),
                Value::String(text) => {
                    let normalized = text.trim();
                    if normalized.is_empty() {
                        return false;
                    }
                    if key_hint.is_some_and(is_sensitive_key) {
                        return true;
                    }
                    normalized.contains("Bearer ")
                        || normalized.contains("Authorization:")
                        || normalized.contains("cookie=")
                        || normalized.contains("token=")
                        || normalized.contains("password=")
                }
                _ => false,
            }
        }

        if payload.is_some_and(|value| walk(value, None)) {
            "flagged"
        } else {
            "passed"
        }
    }

    #[cfg(test)]
    pub fn start_capture_session(
        &self,
        request: StartCaptureRequest,
        collector_ack: Option<CollectorCaptureAck>,
    ) -> AppResult<StartCaptureResponse> {
        Self::validate_capture_type(&request.capture_type)?;
        let now = Local::now().to_rfc3339();
        let note = collector_ack
            .as_ref()
            .map(|ack| ack.message.clone())
            .unwrap_or_else(|| {
                "sidecar protocol is wired, real runtime hook integration follows".to_string()
            });
        let collector_status = collector_ack
            .as_ref()
            .and_then(|ack| ack.status.clone())
            .unwrap_or_else(|| "running".to_string());
        let collector_capture = collector_ack.as_ref().and_then(|ack| ack.capture_result());
        let capture_payload = collector_capture
            .as_ref()
            .map(|result| CaptureSessionCapture::Typed(Box::new(result.collector_payload.clone())))
            .or_else(|| {
                collector_ack
                    .as_ref()
                    .and_then(|ack| ack.payload.as_ref())
                    .map(|payload| CaptureSessionCapture::Raw(payload.clone()))
            })
            .unwrap_or_else(|| {
                CaptureSessionCapture::Typed(Box::new(Self::default_capture_payload(&request.capture_type)))
            });
        let collector_mode = match &capture_payload {
            CaptureSessionCapture::Typed(payload) => payload.collector_mode.clone(),
            CaptureSessionCapture::Raw(payload) => payload
                .get("collectorMode")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| {
                    if collector_ack.is_some() {
                        "sidecar".to_string()
                    } else {
                        "preview".to_string()
                    }
                }),
        };
        let sidecar_session_id = collector_ack
            .as_ref()
            .and_then(|ack| ack.session_id.clone());
        let mut connection = self.conn();
        let transaction = connection.transaction()?;
        let base_summary = CaptureSessionSummaryRecord {
            collector: collector_mode.clone(),
            status: collector_status.clone(),
            note: note.clone(),
            capture: capture_payload.clone(),
            sidecar_session_id: sidecar_session_id.clone(),
            preview_insert_counts: None,
            raw_artifact: None,
        };
        transaction.execute(
            "INSERT INTO capture_session
               (workspace_id, alliance_id, capture_type, status, started_at, summary_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                request.workspace_id,
                request.alliance_id,
                request.capture_type,
                collector_status.clone(),
                now,
                Self::serialize_summary_json(&base_summary)?
            ],
        )?;
        let session_id = transaction.last_insert_rowid();
        let manifest_info = collector_ack
            .as_ref()
            .map(|ack| {
                self.record_capture_manifest_artifact(
                    &transaction,
                    session_id,
                    &request.capture_type,
                    ack,
                    now.as_str(),
                )
            })
            .transpose()?;
        let runtime_artifacts = collector_ack
            .as_ref()
            .map(|ack| {
                self.record_runtime_evidence_artifacts(
                    &transaction,
                    session_id,
                    &request.capture_type,
                    ack,
                    now.as_str(),
                )
            })
            .transpose()?
            .unwrap_or_default();
        let preview_counts = self.normalize_capture_preview(NormalizePreviewContext {
            connection: &transaction,
            session_id,
            workspace_id: request.workspace_id,
            alliance_id: request.alliance_id,
            raw_artifact_id: runtime_artifacts
                .first()
                .map(|(raw_artifact_id, _, _, _)| *raw_artifact_id)
                .or_else(|| {
                    manifest_info
                        .as_ref()
                        .map(|(raw_artifact_id, _, _)| *raw_artifact_id)
                })
                .unwrap_or_default(),
            collector_ack: collector_ack.as_ref(),
            captured_at: now.as_str(),
        })?;
        let final_summary = CaptureSessionSummaryRecord {
            collector: collector_mode,
            status: collector_status.clone(),
            note,
            capture: capture_payload,
            sidecar_session_id,
            preview_insert_counts: Some(preview_counts),
            raw_artifact: runtime_artifacts
                .first()
                .map(
                    |(raw_artifact_id, raw_artifact_path, raw_artifact_sha256, artifact_type)| {
                        CaptureManifestArtifactSummary {
                            id: *raw_artifact_id,
                            path: raw_artifact_path.clone(),
                            sha256: raw_artifact_sha256.clone(),
                            artifact_type: artifact_type.clone(),
                        }
                    },
                )
                .or_else(|| {
                    manifest_info.as_ref().map(
                        |(raw_artifact_id, raw_artifact_path, raw_artifact_sha256)| {
                            CaptureManifestArtifactSummary {
                                id: *raw_artifact_id,
                                path: raw_artifact_path.clone(),
                                sha256: raw_artifact_sha256.clone(),
                                artifact_type: "capture_manifest".to_string(),
                            }
                        },
                    )
                }),
        };
        transaction.execute(
            "UPDATE capture_session SET summary_json = ?1 WHERE id = ?2",
            params![Self::serialize_summary_json(&final_summary)?, session_id],
        )?;
        transaction.commit()?;

        Ok(StartCaptureResponse {
            session_id,
            status: collector_status,
            started_at: now,
            message: if manifest_info.is_some() {
                "采集会话已创建，结构化采集摘要和捕获清单已写入本地数据库。".to_string()
            } else {
                "采集会话已创建，结构化采集摘要已写入本地数据库。".to_string()
            },
        })
    }

    pub fn start_pending_capture_session(
        &self,
        request: &StartCaptureRequest,
        collector_mode: &str,
        note: &str,
    ) -> AppResult<StartCaptureResponse> {
        Self::validate_capture_type(&request.capture_type)?;
        let now = Local::now().to_rfc3339();
        let capture_payload =
            CaptureSessionCapture::Typed(Box::new(Self::default_capture_payload(&request.capture_type)));
        let summary = CaptureSessionSummaryRecord {
            collector: collector_mode.to_string(),
            status: "running".to_string(),
            note: note.to_string(),
            capture: capture_payload,
            sidecar_session_id: None,
            preview_insert_counts: None,
            raw_artifact: None,
        };
        let connection = self.conn();
        connection.execute(
            "INSERT INTO capture_session
               (workspace_id, alliance_id, capture_type, status, started_at, summary_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                request.workspace_id,
                request.alliance_id,
                request.capture_type,
                "running",
                now,
                Self::serialize_summary_json(&summary)?
            ],
        )?;
        let session_id = connection.last_insert_rowid();
        Ok(StartCaptureResponse {
            session_id,
            status: "running".to_string(),
            started_at: now,
            message: note.to_string(),
        })
    }

    pub fn fail_running_capture_sessions(&self, note: &str) -> AppResult<usize> {
        self.close_running_capture_sessions("failed", note)
    }

    pub fn stop_running_capture_sessions(&self, note: &str) -> AppResult<usize> {
        self.close_running_capture_sessions("stopped", note)
    }

    fn close_running_capture_sessions(&self, status: &str, note: &str) -> AppResult<usize> {
        let now = Local::now().to_rfc3339();
        let mut connection = self.conn();
        let rows = {
            let mut statement = connection.prepare(
                "SELECT id, capture_type, summary_json
                 FROM capture_session
                 WHERE status = 'running'",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let transaction = connection.transaction()?;
        let mut updated = 0usize;
        for (session_id, capture_type, summary_json) in rows {
            let mut summary = summary_json
                .as_deref()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .unwrap_or_else(|| json!({}));
            if let Value::Object(ref mut map) = summary {
                map.insert("status".to_string(), json!(status));
                map.insert("note".to_string(), json!(note));
                map.insert("message".to_string(), json!(note));
                map.insert("finishedAt".to_string(), json!(now));
                map.entry("previewInsertCounts".to_string())
                    .or_insert(serde_json::to_value(CapturePreviewCounts::default())?);
                if !map.get("capture").map(Value::is_object).unwrap_or(false) {
                    map.insert(
                        "capture".to_string(),
                        serde_json::to_value(Self::default_capture_payload(&capture_type))?,
                    );
                }
                if let Some(Value::Object(capture)) = map.get_mut("capture") {
                    capture.entry("runtime".to_string()).or_insert(json!({
                        "status": status,
                        "recordCount": 0,
                        "message": note,
                        "finishedAt": now,
                    }));
                }
            }
            let artifact_info = self.record_capture_lifecycle_artifact(
                CaptureLifecycleArtifactRequest {
                    connection: &transaction,
                    capture_session_id: session_id,
                    capture_type: &capture_type,
                    status,
                    note,
                    captured_at: now.as_str(),
                    summary: &summary,
                },
            )?;
            if let Value::Object(ref mut map) = summary {
                map.insert(
                    "rawArtifact".to_string(),
                    json!({
                        "id": artifact_info.0,
                        "path": artifact_info.1,
                        "sha256": artifact_info.2,
                        "artifactType": "capture_lifecycle",
                    }),
                );
            }
            let mut serialized = serde_json::to_string(&summary)?;
            {
                // 复用剥离逻辑：close 收尾读改写时会回写整树，保证剥离后的状态被保持。
                let mut value: Value = serde_json::from_str(&serialized)?;
                Self::strip_evidence_from_summary(&mut value);
                serialized = serde_json::to_string(&value)?;
            }
            updated += transaction.execute(
                "UPDATE capture_session
                 SET status = ?1, finished_at = ?2, summary_json = ?3
                 WHERE id = ?4 AND status = 'running'",
                params![status, now, serialized, session_id],
            )?;
        }
        transaction.commit()?;
        Ok(updated)
    }

    pub fn finish_capture_session(
        &self,
        session_id: i64,
        request: StartCaptureRequest,
        collector_ack: CollectorCaptureAck,
    ) -> AppResult<()> {
        let now = Local::now().to_rfc3339();
        let note = collector_ack.message.clone();
        let collector_status = collector_ack
            .status
            .clone()
            .unwrap_or_else(|| "completed".to_string());
        let collector_capture = collector_ack.capture_result();
        let capture_payload = collector_capture
            .as_ref()
            .map(|result| CaptureSessionCapture::Typed(Box::new(result.collector_payload.clone())))
            .or_else(|| {
                collector_ack
                    .payload
                    .as_ref()
                    .map(|payload| CaptureSessionCapture::Raw(payload.clone()))
            })
            .unwrap_or_else(|| {
                CaptureSessionCapture::Typed(Box::new(Self::default_capture_payload(&request.capture_type)))
            });
        let collector_mode = match &capture_payload {
            CaptureSessionCapture::Typed(payload) => payload.collector_mode.clone(),
            CaptureSessionCapture::Raw(payload) => payload
                .get("collectorMode")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "sidecar".to_string()),
        };
        let sidecar_session_id = collector_ack.session_id.clone();
        let mut connection = self.conn();
        let transaction = connection.transaction()?;
        let current_status: Option<String> = transaction
            .query_row(
                "SELECT status FROM capture_session WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?;
        // The session may have been deleted (or never persisted) by the time a
        // late collector ack arrives; treat that as a no-op instead of an error.
        let Some(current_status) = current_status else {
            transaction.commit()?;
            return Ok(());
        };
        if !matches!(current_status.as_str(), "running" | "stopped" | "failed") {
            transaction.commit()?;
            return Ok(());
        }
        if current_status != "running" {
            let lifecycle_payload = json!({
                "status": "late_ack_ignored",
                "sessionStatus": current_status,
                "collectorStatus": collector_status.clone(),
                "message": note.clone(),
                "sidecarSessionId": sidecar_session_id.clone(),
                "captureType": request.capture_type.clone(),
                "receivedAt": now,
            });
            let lifecycle_note =
                format!("ignored late collector ack for {current_status} capture session");
            self.record_capture_lifecycle_artifact(CaptureLifecycleArtifactRequest {
                connection: &transaction,
                capture_session_id: session_id,
                capture_type: &request.capture_type,
                status: "late_ack_ignored",
                note: &lifecycle_note,
                captured_at: now.as_str(),
                summary: &lifecycle_payload,
            })?;
            transaction.commit()?;
            return Ok(());
        }
        let final_status = if current_status == "running" {
            collector_status.clone()
        } else {
            current_status.clone()
        };
        let manifest_info = self.record_capture_manifest_artifact(
            &transaction,
            session_id,
            &request.capture_type,
            &collector_ack,
            now.as_str(),
        )?;
        let runtime_artifacts = self.record_runtime_evidence_artifacts(
            &transaction,
            session_id,
            &request.capture_type,
            &collector_ack,
            now.as_str(),
        )?;
        let preview_counts = if current_status == "running" {
            self.normalize_capture_preview(NormalizePreviewContext {
                connection: &transaction,
                session_id,
                workspace_id: request.workspace_id,
                alliance_id: request.alliance_id,
                raw_artifact_id: runtime_artifacts
                    .first()
                    .map(|(raw_artifact_id, _, _, _)| *raw_artifact_id)
                    .unwrap_or(manifest_info.0),
                collector_ack: Some(&collector_ack),
                captured_at: now.as_str(),
            })?
        } else {
            CapturePreviewCounts::default()
        };
        let final_summary = CaptureSessionSummaryRecord {
            collector: collector_mode,
            status: final_status.clone(),
            note,
            capture: capture_payload,
            sidecar_session_id,
            preview_insert_counts: Some(preview_counts),
            raw_artifact: runtime_artifacts
                .first()
                .map(
                    |(raw_artifact_id, raw_artifact_path, raw_artifact_sha256, artifact_type)| {
                        CaptureManifestArtifactSummary {
                            id: *raw_artifact_id,
                            path: raw_artifact_path.clone(),
                            sha256: raw_artifact_sha256.clone(),
                            artifact_type: artifact_type.clone(),
                        }
                    },
                )
                .or_else(|| {
                    Some(CaptureManifestArtifactSummary {
                        id: manifest_info.0,
                        path: manifest_info.1.clone(),
                        sha256: manifest_info.2.clone(),
                        artifact_type: "capture_manifest".to_string(),
                    })
                }),
        };
        transaction.execute(
            "UPDATE capture_session
             SET status = ?1, finished_at = ?2, summary_json = ?3
             WHERE id = ?4",
            params![
                final_status,
                now,
                Self::serialize_summary_json(&final_summary)?,
                session_id
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Delete a capture session and everything tied to it:
    /// 1. Collect the raw_artifact disk paths (relative to app_data_dir) for the session.
    /// 2. Delete those files (capture-manifests / raw/runtime evidence).
    /// 3. Delete the `capture_session` row — FK `ON DELETE CASCADE` removes all
    ///    dependent rows (raw_artifact, member_snapshot, union_log_event, etc.).
    ///
    /// File deletion happens after the DB transaction commits, so a file error
    /// never leaves the DB half-deleted. The session is required to belong to
    /// the given workspace, so callers cannot remove another workspace's data.
    pub fn delete_capture_session(&self, session_id: i64, workspace_id: i64) -> AppResult<()> {
        // Verify the session exists and belongs to the workspace.
        let conn = self.conn();
        let owned: Option<bool> = conn
            .query_row(
                "SELECT workspace_id = ?2 FROM capture_session WHERE id = ?1",
                params![session_id, workspace_id],
                |row| row.get(0),
            )
            .optional()?;
        match owned {
            None => {
                return Err(AppError::Message(format!(
                    "capture session {session_id} does not exist"
                )));
            }
            Some(false) => {
                return Err(AppError::Message(format!(
                    "capture session {session_id} does not belong to the current workspace"
                )));
            }
            Some(true) => {}
        }

        // Collect raw artifact paths before deleting the row (row deletion
        // cascades raw_artifact away, so paths must be read first).
        let mut statement = conn.prepare(
            "SELECT path FROM raw_artifact WHERE capture_session_id = ?1",
        )?;
        let paths: Vec<String> = statement
            .query_map(params![session_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        // Delete the session row; FK cascade removes dependent rows.
        conn.execute(
            "DELETE FROM capture_session WHERE id = ?1 AND workspace_id = ?2",
            params![session_id, workspace_id],
        )?;

        // Clean up the disk artifacts (best effort — a missing file is fine,
        // only permission/IO errors are surfaced).
        for relative_path in paths {
            let resolved = self.app_data_dir.join(&relative_path);
            if !resolved.starts_with(&self.app_data_dir) {
                // Defensive: never delete outside app_data_dir even if a row
                // was tampered with.
                continue;
            }
            match fs::remove_file(&resolved) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(AppError::Message(format!(
                        "failed to delete raw artifact {}: {error}",
                        resolved.display()
                    )));
                }
            }
        }
        Ok(())
    }
}
