use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

// ── ts-rs 导出约定（S1-5）──
// 所有跨 IPC 类型派生 TS 并 #[ts(export)]，cargo test 时写入 ../src/lib/bindings/（已入库）。
// 字段级标注规则：
//   - i64/u64 字段：serde_json 序列化为 JSON number，ts-rs 默认映射 bigint 会破坏前端，
//     故统一 #[ts(as = "i32")]（Option<i64> 用 "Option<i32>"，Vec<i64> 用 "Vec<i32>"）。
//   - #[serde(skip_serializing_if = "Option::is_none")] 字段：ts-rs serde-compat 无法解析该
//     属性，用 #[ts(optional)] 显式声明可选，与运行时「None 时省略键」行为一致。
//   - serde_json::Value 字段：显式 #[ts(type = "...")]（不启用 serde-json-impl，
//     避免 JsonValue 联合类型破坏前端索引访问；遗漏会在编译期报错）。

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct WorkspaceSummary {
    #[ts(as = "i32")]
    pub workspace_count: i64,
    #[ts(as = "i32")]
    pub alliance_count: i64,
    #[ts(as = "i32")]
    pub capture_session_count: i64,
    #[ts(as = "i32")]
    pub raw_artifact_count: i64,
    #[ts(as = "i32")]
    pub export_job_count: i64,
    #[ts(as = "i32")]
    pub member_snapshot_count: i64,
    #[ts(as = "i32")]
    pub building_snapshot_count: i64,
    #[ts(as = "i32")]
    pub battle_block_count: i64,
    #[ts(as = "i32")]
    pub lineup_profile_count: i64,
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct WorkspaceRecord {
    #[ts(as = "i32")]
    pub id: i64,
    pub name: String,
    pub server_name: String,
    pub season_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alliance_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alliance_game_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub server_name: String,
    pub season_name: String,
    pub alliance_name: String,
    pub alliance_game_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CreateWorkspaceResponse {
    pub workspace: WorkspaceRecord,
    #[ts(as = "i32")]
    pub alliance_id: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CollectorStatus {
    pub available: bool,
    pub mode: String,
    pub message: String,
    pub capture_flows: BTreeMap<String, CollectorFlowStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    // runtime_probe 为动态探测结果；前端在 tauri.ts 收窄为 RuntimeProbeStatus。
    #[ts(type = "unknown")]
    pub runtime_probe: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CollectorFlowStatus {
    pub flow: String,
    pub expected_artifacts: Vec<String>,
    pub navigation: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_probe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, unknown>")]
    pub preview: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CollectorCaptureAck {
    pub status: Option<String>,
    pub message: String,
    pub session_id: Option<String>,
    #[ts(type = "unknown")]
    pub payload: Option<Value>,
}

/// 阶段3a 采集完成事件 payload：start_capture_session 后台闭包在
/// finish_capture_session 之后（成功与失败路径都会）emit
/// `"capture-session-finished"`，前端据此刷新采集会话列表。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CaptureSessionFinished {
    #[ts(as = "i32")]
    pub session_id: i64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CollectorCapturePayload {
    pub collector_mode: String,
    pub capture_type: String,
    pub flow: String,
    pub expected_artifacts: Vec<String>,
    pub navigation: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_probe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, unknown> | null")]
    pub preview: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, unknown> | null")]
    pub runtime: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, unknown> | null")]
    pub evidence: Option<Value>,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CapturePreviewCounts {
    #[ts(as = "i32")]
    pub member_snapshots: i64,
    #[ts(as = "i32")]
    pub legion_groups: i64,
    #[ts(as = "i32")]
    pub union_log_events: i64,
    #[ts(as = "i32")]
    pub building_snapshots: i64,
    #[ts(as = "i32")]
    pub battle_blocks: i64,
    #[ts(as = "i32")]
    pub lineup_profiles: i64,
    /// 同盟情报快照（排行榜/红度/赛季战队/主公簿/同盟建筑/同盟历史）数量
    #[ts(as = "i32")]
    pub intel_snapshots: i64,
    /// 情报快照下的明细条目总数
    #[ts(as = "i32")]
    pub intel_entries: i64,
}

/// 同盟情报快照行。
///
/// 一个"主题"一行：某个榜单（繁荣榜·司仓）、某位玩家的红度普查、某支赛季战队。
/// `payloadJson` 保留游戏原始载荷，使协议演进后可以只改解析器重放历史数据。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct IntelSnapshotRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub workspace_id: i64,
    #[ts(as = "i32")]
    pub alliance_id: i64,
    /// server_rank | hero_rating | season_team | player_profile | union_building | union_history
    pub kind: String,
    pub subject_key: String,
    pub subject_label: String,
    pub observed_at: String,
    #[ts(as = "i32")]
    pub entry_count: i64,
    pub metrics_json: String,
    pub source_func: String,
}

/// 同盟情报明细行（榜单名次 / 战队成员 / 武将红度行）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct IntelEntryRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub snapshot_id: i64,
    pub kind: String,
    #[ts(as = "i32")]
    pub rank: i64,
    pub subject_key: String,
    pub name: String,
    pub union_name: String,
    pub value: f64,
    pub extra_json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct PagedIntelSnapshots {
    pub rows: Vec<IntelSnapshotRow>,
    #[ts(as = "i32")]
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct PagedIntelEntries {
    pub rows: Vec<IntelEntryRow>,
    #[ts(as = "i32")]
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CaptureManifestArtifactSummary {
    #[ts(as = "i32")]
    pub id: i64,
    pub path: String,
    pub sha256: String,
    pub artifact_type: String,
}

// CaptureSessionCapture 不派生 TS：untagged 枚举（Typed CollectorCapturePayload | Raw 任意 JSON）
// 经 ts-rs 导出为联合类型后，前端无法再做 capture.captureType / capture.runtime 等属性访问。
// 对应手写合并形状见 src/lib/bindings/CaptureSessionCapture.ts（该文件头注释说明维护规则）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CaptureSessionCapture {
    Typed(Box<CollectorCapturePayload>),
    Raw(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CaptureSessionSummaryRecord {
    pub collector: String,
    pub status: String,
    pub note: String,
    #[ts(type = "import(\"./CaptureSessionCapture\").CaptureSessionCapture")]
    pub capture: CaptureSessionCapture,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sidecar_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preview_insert_counts: Option<CapturePreviewCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw_artifact: Option<CaptureManifestArtifactSummary>,
}

impl CollectorCapturePayload {
    pub fn default_for_capture_type(capture_type: &str) -> Self {
        match capture_type {
            "battle_passive" => Self {
                collector_mode: "preview".to_string(),
                capture_type: capture_type.to_string(),
                flow: "battle_listener".to_string(),
                expected_artifacts: vec![
                    "battle_block_list".to_string(),
                    "battle_detail".to_string(),
                    "battle_environment".to_string(),
                ],
                navigation: vec![
                    "战报入口".to_string(),
                    "战报列表".to_string(),
                    "子战斗".to_string(),
                    "详情".to_string(),
                    "固定阵容".to_string(),
                ],
                next_probe: Some("__install_battle_listener_hooks__".to_string()),
                preview: None,
                runtime: None,
                evidence: None,
            },
            _ => Self {
                collector_mode: "preview".to_string(),
                capture_type: capture_type.to_string(),
                flow: "alliance_runtime".to_string(),
                expected_artifacts: vec![
                    "rpc_dump".to_string(),
                    "ui_snapshot".to_string(),
                    "static_config".to_string(),
                ],
                navigation: vec![
                    "同盟首页".to_string(),
                    "成员列表".to_string(),
                    "成员详情".to_string(),
                    "日志分类".to_string(),
                    "设施科技".to_string(),
                    "辎重运输".to_string(),
                    "排行榜".to_string(),
                    "静态配置".to_string(),
                    "校验入库".to_string(),
                ],
                next_probe: Some("__noop__".to_string()),
                preview: None,
                runtime: None,
                evidence: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CollectorCaptureResult {
    pub collector_mode: String,
    pub capture_type: String,
    pub collector_payload: CollectorCapturePayload,
}

impl CollectorCaptureResult {
    pub fn preview(&self) -> Option<&Value> {
        self.collector_payload.preview.as_ref()
    }
}

impl CollectorCaptureAck {
    pub fn capture_result(&self) -> Option<CollectorCaptureResult> {
        let payload = self.payload.as_ref()?;
        serde_json::from_value(payload.clone()).ok()
    }
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct StartCaptureRequest {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub capture_type: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct StartCaptureResponse {
    #[ts(as = "i32")]
    pub session_id: i64,
    pub status: String,
    pub started_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct StopCaptureResponse {
    pub stopped: bool,
    pub closed_sessions: usize,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct SaveMemberBindingRequest {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub avatar_id: String,
    pub avatar_name: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct SaveLineupProfileRequest {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub player_name: String,
    pub player_avatar_id: Option<String>,
    pub side: Option<String>,
    pub label: String,
    pub heroes: Vec<String>,
    pub source_battle_id: Option<String>,
    pub confidence: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CaptureSessionRow {
    #[ts(as = "i32")]
    pub id: i64,
    pub capture_type: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    // 2026-08-08 崩溃修复：summary_json 曾携带完整 RPC evidence（单行最大 26MB），
    // 经 get_app_bundle 序列化灌给前端 WebView2 导致内存爆掉崩溃。
    // 现在写入时已剥离 evidence（见 capture.rs strip_evidence_from_summary），
    // 剩余内容为精简 preview/runtime 摘要（KB~百KB 级）。
    // 2026-09-20 修复（审查 P1-5）：字段改为 Option + #[ts(optional)]，
    // 使 Rust 侧"空值不输出"与 TS 绑定的可选语义天然一致——此前用
    // `String` + skip_serializing_if 时，手写的 `summaryJson?` 会被
    // ts-rs 重新生成为必填，导致类型与运行时不符（读到 undefined 却不报错）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<CaptureSessionSummaryRecord>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct RawArtifactRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub capture_session_id: i64,
    pub artifact_type: String,
    pub path: String,
    pub source_module: Option<String>,
    pub source_func: Option<String>,
    pub captured_at: String,
    pub sha256: Option<String>,
    pub sensitive_scan_status: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct MemberSnapshotRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub capture_session_id: i64,
    pub observed_at: String,
    pub avatar_id: String,
    pub avatar_name: String,
    pub official_name: String,
    pub profession_name: String,
    #[ts(as = "i32")]
    pub profession_id: i64,
    pub state: Option<String>,
    #[ts(as = "i32")]
    pub is_online: i64,
    #[ts(as = "i32")]
    pub role_id: i64,
    pub legion_name: String,
    #[ts(as = "i32")]
    pub legion_id: i64,
    #[ts(as = "i32")]
    pub legion_leader: i64,
    #[ts(as = "i32")]
    pub prosperity: i64,
    #[ts(as = "i32")]
    pub weekly_contribution: i64,
    #[ts(as = "i32")]
    pub weekly_merit: i64,
    #[ts(as = "i32")]
    pub season_score: i64,
    #[ts(as = "i32")]
    pub demolition_value: i64,
    #[ts(as = "i32")]
    pub coordinate_x: i64,
    #[ts(as = "i32")]
    pub coordinate_y: i64,
    #[ts(as = "i32")]
    pub last_offline_ts: i64,
    #[ts(as = "i32")]
    pub join_ts: i64,
    #[ts(as = "i32")]
    pub t_feat: i64,
    #[ts(as = "i32")]
    pub t_forage_use: i64,
    #[ts(as = "i32")]
    pub w_forage_use: i64,
    pub weekly_statistics_json: String,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct BuildingSnapshotRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub capture_session_id: i64,
    pub observed_at: String,
    pub building_name: String,
    pub facility_type: String,
    #[ts(as = "i32")]
    pub facility_type_id: i64,
    #[ts(as = "i32")]
    pub role_facility_type: i64,
    #[ts(as = "i32")]
    pub cfg_id: i64,
    pub carrier_id: String,
    pub level: String,
    pub state: String,
    #[ts(as = "i32")]
    pub status_id: i64,
    #[ts(as = "i32")]
    pub coordinate_x: i64,
    #[ts(as = "i32")]
    pub coordinate_y: i64,
    pub operator_avatar_id: String,
    pub operator_name: String,
    #[ts(as = "i32")]
    pub benefit: i64,
    #[ts(as = "i32")]
    pub mine_count: i64,
    #[ts(as = "i32")]
    pub max_mine_count: i64,
    pub effect: String,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct AllianceMemberRow {
    pub avatar_id: String,
    pub name: String,
    pub official: String,
    pub profession: String,
    #[ts(as = "i32")]
    pub is_online: i64,
    pub legion: String,
    #[ts(as = "i32")]
    pub prosperity: i64,
    #[ts(as = "i32")]
    pub contribution: i64,
    #[ts(as = "i32")]
    pub merit: i64,
    #[ts(as = "i32")]
    pub season_score: i64,
    #[ts(as = "i32")]
    pub last_offline_ts: i64,
    #[ts(as = "i32")]
    pub demolition: i64,
    pub coord: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct AllianceLogRow {
    #[ts(as = "i32")]
    pub capture_session_id: i64,
    pub time: String,
    pub category: String,
    pub section: String,
    pub actor: String,
    pub target: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct AllianceFacilityRow {
    pub name: String,
    pub facility_type: String,
    #[ts(as = "i32")]
    pub cfg_id: i64,
    pub carrier_id: String,
    pub level: String,
    pub state: String,
    pub coord: String,
    pub operator_name: String,
    #[ts(as = "i32")]
    pub benefit: i64,
    pub effect: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct AllianceGroupRow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub capture_session_id: Option<i64>,
    #[ts(as = "i32")]
    pub group_id: i64,
    pub group_name: String,
    #[ts(as = "i32")]
    pub legion_id: i64,
    pub legion_name: String,
    #[ts(as = "i32")]
    pub member_count: i64,
    pub observed_at: String,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct BattleReportRow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub workspace_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub time: String,
    pub battle_code: String,
    pub enemy: String,
    pub enemy_player: String,
    pub result: String,
    /// 实际战斗结束回合（endRound）。历史实现误读 match_type，已修正为 end_round。
    #[ts(as = "i32")]
    pub round: i64,
    pub location: String,
    pub lineup: String,
    pub battle_id: String,
    pub battlefield_environment_json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct LineupProfileRow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub player_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub label: String,
    pub player: String,
    pub heroes: String,
    pub source: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct MemberBindingRow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub player_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(as = "Option<i32>")]
    pub alliance_id: Option<i64>,
    pub name: String,
    pub avatar: String,
    pub alliance: String,
    pub status: String,
    pub updated: String,
    /// 是否为当前生效绑定（valid_to IS NULL）。历史行 valid_to 非空时为 false。
    pub is_active: bool,
}

/// SQL-side comparison counters for a single date window.
/// Populated by `Database::query_comparison_stats`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct ComparisonStats {
    #[ts(as = "i32")]
    pub members: i64,
    #[ts(as = "i32")]
    pub buildings: i64,
    #[ts(as = "i32")]
    pub battles: i64,
    #[ts(as = "i32")]
    pub sessions: i64,
}

/// 战报分页结果（阶段3a 分片命令 get_battle_reports_paged 的返回类型）。
/// rows 为当前页数据，total 为满足过滤条件的总行数（用于前端分页器）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct PagedBattleReports {
    pub rows: Vec<BattleReportRow>,
    #[ts(as = "i32")]
    pub total: i64,
}

/// 同盟日志分页结果（阶段3a 分片命令 get_alliance_logs_paged 的返回类型）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct PagedAllianceLogs {
    pub rows: Vec<AllianceLogRow>,
    #[ts(as = "i32")]
    pub total: i64,
}

/// 成员快照分页结果（阶段3a 分片命令 get_member_snapshots 的返回类型）。
/// latest_only=true 时 total 为去重后的成员人数，否则为快照总行数。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct PagedMemberSnapshots {
    pub rows: Vec<MemberSnapshotRow>,
    #[ts(as = "i32")]
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct ExportJobRow {
    #[ts(as = "i32")]
    pub id: i64,
    pub created_at: String,
    pub job_kind: String,
    pub format: String,
    pub target: String,
    pub status: String,
    pub output_paths: Vec<String>,
}

/// 前端 IPC 用的瘦身 bundle（阶段3a）：只携带 summary + 小表元数据。
/// 战报明细、同盟日志、成员/设施快照大表已移除，前端改走分片命令：
/// get_battle_reports_paged / get_alliance_logs_paged / get_member_snapshots。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct AppBundle {
    pub summary: WorkspaceSummary,
    pub workspaces: Vec<WorkspaceRecord>,
    pub capture_sessions: Vec<CaptureSessionRow>,
    pub raw_artifacts: Vec<RawArtifactRow>,
    pub export_jobs: Vec<ExportJobRow>,
    pub alliance_members: Vec<AllianceMemberRow>,
    pub alliance_facilities: Vec<AllianceFacilityRow>,
    pub alliance_groups: Vec<AllianceGroupRow>,
    pub lineup_profiles: Vec<LineupProfileRow>,
    pub member_bindings: Vec<MemberBindingRow>,
}

/// 内部全量 bundle（仅供导出/备份/诊断路径使用，deprecated for UI）。
/// 阶段3a 起前端 IPC 不再消费此结构；导出 json/xlsx/html/csv 仍需要全表数据。
/// 不导出 ts-rs 类型（前端不可见）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalFullAppBundle {
    pub summary: WorkspaceSummary,
    pub workspaces: Vec<WorkspaceRecord>,
    pub capture_sessions: Vec<CaptureSessionRow>,
    pub raw_artifacts: Vec<RawArtifactRow>,
    pub export_jobs: Vec<ExportJobRow>,
    pub member_snapshots: Vec<MemberSnapshotRow>,
    pub building_snapshots: Vec<BuildingSnapshotRow>,
    pub alliance_members: Vec<AllianceMemberRow>,
    pub alliance_logs: Vec<AllianceLogRow>,
    pub alliance_facilities: Vec<AllianceFacilityRow>,
    pub alliance_groups: Vec<AllianceGroupRow>,
    pub battle_reports: Vec<BattleReportRow>,
    pub featured_battle: Option<BattleReportRow>,
    pub lineup_profiles: Vec<LineupProfileRow>,
    pub member_bindings: Vec<MemberBindingRow>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct ExportResult {
    pub kind: String,
    pub format: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct ExportDirectoryInfo {
    pub path: String,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct ExportBattleReportRequest {
    pub battle_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct LineupStatRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub workspace_id: i64,
    pub avatar_id: String,
    pub player_name: String,
    pub alliance_name: String,
    pub lineup_key: String,
    pub label: String,
    pub formation_id: String,
    pub formation_name: String,
    pub hero_ids_json: String,
    pub hero_levels_json: String,
    pub avg_evolution: f64,
    #[ts(as = "i32")]
    pub battles: i64,
    #[ts(as = "i32")]
    pub wins: i64,
    #[ts(as = "i32")]
    pub losses: i64,
    #[ts(as = "i32")]
    pub draws: i64,
    #[ts(as = "i32")]
    pub attack_battles: i64,
    #[ts(as = "i32")]
    pub defend_battles: i64,
    #[ts(as = "i32")]
    pub total_merit: i64,
    #[ts(as = "i32")]
    pub total_origin_troops: i64,
    #[ts(as = "i32")]
    pub total_remaining_troops: i64,
    #[ts(as = "i32")]
    pub total_wounded: i64,
    #[ts(as = "i32")]
    pub total_dead: i64,
    #[ts(as = "i32")]
    pub total_enemy_origin_troops: i64,
    #[ts(as = "i32")]
    pub total_enemy_remaining_troops: i64,
    #[ts(as = "i32")]
    pub total_enemy_wounded: i64,
    #[ts(as = "i32")]
    pub total_enemy_dead: i64,
    pub loss_exchange_ratio: f64,
    pub last_battle_time: String,
    pub notes: Option<String>,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct LineupMatchupRow {
    #[ts(as = "i32")]
    pub id: i64,
    #[ts(as = "i32")]
    pub workspace_id: i64,
    pub attacker_avatar_id: String,
    pub attacker_player_name: String,
    pub attacker_lineup_key: String,
    pub attacker_lineup_label: String,
    pub defender_avatar_id: String,
    pub defender_player_name: String,
    pub defender_lineup_key: String,
    pub defender_lineup_label: String,
    pub outcome: String,
    pub battle_time: String,
    pub battle_code: String,
    pub observed_at: String,
    /// S3 战报分类：战斗模式（1 野战/2 攻城/3 守城/4 集结），0 未知
    #[ts(as = "i32")]
    pub match_type: i64,
    /// 战报原始 combatType，0 未知
    #[ts(as = "i32")]
    pub combat_type: i64,
    /// 场景 ID，0 未知
    #[ts(as = "i32")]
    pub scenario_id: i64,
    /// 实际结束回合数
    #[ts(as = "i32")]
    pub end_round: i64,
    /// 战斗地点坐标
    pub location: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct LineupAnalysisBundle {
    pub stats: Vec<LineupStatRow>,
    pub matchups: Vec<LineupMatchupRow>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct UpsertLineupStatRequest {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    pub avatar_id: String,
    pub player_name: String,
    pub alliance_name: String,
    pub lineup_key: String,
    pub label: String,
    pub formation_id: String,
    pub formation_name: String,
    pub hero_ids: Vec<String>,
    #[ts(as = "Vec<i32>")]
    pub hero_levels: Vec<i64>,
    pub avg_evolution: f64,
    #[ts(as = "i32")]
    pub battles: i64,
    #[ts(as = "i32")]
    pub wins: i64,
    #[ts(as = "i32")]
    pub losses: i64,
    #[ts(as = "i32")]
    pub draws: i64,
    #[ts(as = "i32")]
    pub attack_battles: i64,
    #[ts(as = "i32")]
    pub defend_battles: i64,
    #[ts(as = "i32")]
    pub total_merit: i64,
    #[ts(as = "i32")]
    pub total_origin_troops: i64,
    #[ts(as = "i32")]
    pub total_remaining_troops: i64,
    #[ts(as = "i32")]
    pub total_wounded: i64,
    #[ts(as = "i32")]
    pub total_dead: i64,
    #[ts(as = "i32")]
    pub total_enemy_origin_troops: i64,
    #[ts(as = "i32")]
    pub total_enemy_remaining_troops: i64,
    #[ts(as = "i32")]
    pub total_enemy_wounded: i64,
    #[ts(as = "i32")]
    pub total_enemy_dead: i64,
    pub loss_exchange_ratio: f64,
    pub last_battle_time: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct LineupMatchupInput {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    pub attacker_avatar_id: String,
    pub attacker_player_name: String,
    pub attacker_lineup_key: String,
    pub attacker_lineup_label: String,
    pub defender_avatar_id: String,
    pub defender_player_name: String,
    pub defender_lineup_key: String,
    pub defender_lineup_label: String,
    pub outcome: String,
    pub battle_time: String,
    pub battle_code: String,
    /// S3 战报分类（可选，缺省 0）
    #[ts(as = "i32")]
    #[serde(default)]
    pub match_type: i64,
    #[ts(as = "i32")]
    #[serde(default)]
    pub combat_type: i64,
    #[ts(as = "i32")]
    #[serde(default)]
    pub scenario_id: i64,
    #[ts(as = "i32")]
    #[serde(default)]
    pub end_round: i64,
    #[serde(default)]
    pub location: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct MemberActivityAlertRow {
    pub avatar_id: String,
    pub avatar_name: String,
    pub official_name: String,
    #[ts(as = "i32")]
    pub weekly_contribution: i64,
    #[ts(as = "i32")]
    pub weekly_merit: i64,
    #[ts(as = "i32")]
    pub last_offline_ts: i64,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct MemberActivityAlerts {
    pub offline_members: Vec<MemberActivityAlertRow>,
    pub low_contribution: Vec<MemberActivityAlertRow>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct CrossWorkspacePowerPoint {
    #[ts(as = "i32")]
    pub workspace_id: i64,
    pub workspace_name: String,
    pub date: String,
    #[ts(as = "i32")]
    pub member_count: i64,
    #[ts(as = "i32")]
    pub total_weekly_merit: i64,
    #[ts(as = "i32")]
    pub total_season_score: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct BackupResult {
    pub path: String,
    #[ts(as = "i32")]
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub struct RestoreResult {
    pub staged: bool,
    pub message: String,
}
