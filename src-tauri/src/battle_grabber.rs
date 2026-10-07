use serde::{Deserialize, Serialize};
use crate::proc_util::hide_subprocess_window;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{path::BaseDirectory, Emitter, Manager, State};
use ts_rs::TS;

// ── ts-rs 导出约定（S1-5）──
// DTO 派生 TS 并 #[ts(export)]，cargo test 时写入 ../src/lib/bindings/（已入库），
// 标注规则同 models.rs 头注：u64→#[ts(as = "u32")]；serde_json::Value 字段显式
// #[ts(type = "...")]（alliance_packets/alliance_records 与前端 JsonRecord[] 对齐）。

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct ProcessInfo {
    pid: u32,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct LogEntry {
    timestamp: String,
    level: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct PacketRecord {
    session_id: String,
    seq: u32,
    msg_id: u32,
    proto_name: String,
    timestamp: String,
    local_dir: String,
    meta_path: String,
    #[ts(as = "u32")]
    content_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct ReportRecord {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    txt: String,
    #[serde(default)]
    md: String,
    #[serde(default)]
    csv: String,
    #[serde(default)]
    json: String,
    #[serde(default)]
    html: String,
    #[serde(default)]
    battle_json: String,
    #[serde(default)]
    battle_md: String,
    #[serde(default)]
    event_count: usize,
    #[serde(default)]
    #[ts(type = "unknown")]
    summary: Value,
    #[serde(default)]
    #[ts(type = "unknown")]
    battle_details: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct SessionRecord {
    id: String,
    source: String,
    output_dir: String,
    summary_path: String,
    generated_at: String,
    process: Option<ProcessInfo>,
    installed: bool,
    packet_count: usize,
    reports: Vec<ReportRecord>,
    report_count: usize,
    alliance_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct ScanWorkspaceRecord {
    name: String,
    output_dir: String,
    session_count: usize,
    updated_at: String,
    active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct ConnectionSnapshot {
    status: String,
    mode: String,
    session_id: String,
    output_dir: String,
    remote_capture_dir: String,
    installed: bool,
    process: Option<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct AppSnapshot {
    /// 单调递增的快照版本号：任何快照数据变化（连接状态/抓包/战报/历史目录等）
    /// 都会 +1。前端用事件 `battle-grabber://snapshot-updated` 收到新版本号，
    /// 再带 `sinceVersion` 调 get_app_snapshot 判断是否需要拉全量。
    #[serde(default)]
    #[ts(as = "u32")]
    version: u64,
    scan_workspace: String,
    workspace_output_dir: String,
    connection: ConnectionSnapshot,
    logs: Vec<LogEntry>,
    packets: Vec<PacketRecord>,
    reports: Vec<ReportRecord>,
    sessions: Vec<SessionRecord>,
    #[ts(type = "Array<Record<string, unknown>>")]
    alliance_packets: Vec<Value>,
    /// P2-2 Phase 1：同盟战报记录**不再随快照下发**。
    /// 单个 workspace 全量记录可达 60+ MB（实测 0730 workspace 63 MB / 5703 条），
    /// 而快照在采集期间会被高频刷新，重复整包推送与 2026-08-08 那次 WebView2 OOM
    /// （138.6 MB 走 IPC）属同类风险。前端改在记录数变化时调用
    /// `get_alliance_records` 显式拉取一次；快照只暴露 `alliance_record_count`。
    #[serde(default, skip_serializing)]
    #[ts(skip)]
    alliance_records: Vec<Value>,
    /// 记录条数（轻量计数，前端据此判断是否需要重新拉取）
    alliance_record_count: usize,
}

/// get_app_snapshot 的返回体：`changed=false` 时不携带 snapshot（轻量「无更新」
/// 应答），前端凭 `version` 与事件流保持缓存一致。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct AppSnapshotResponse {
    changed: bool,
    #[ts(as = "u32")]
    version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    snapshot: Option<AppSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct LiveCaptureSnapshot {
    scan_workspace: String,
    workspace_output_dir: String,
    connection: ConnectionSnapshot,
    logs: Vec<LogEntry>,
    packets: Vec<PacketRecord>,
    reports: Vec<ReportRecord>,
    /// P2-2 Phase 1：见 `AppSnapshot` 的说明——轮询快照不再携带全量记录
    /// （此前这里是「每次轮询都整包 clone + 序列化」的主要风险点）。
    /// 记录改由 `get_alliance_records` 按需拉取。
    alliance_record_count: usize,
}

#[derive(Clone)]
struct BridgeHandle {
    pid: u32,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

struct BridgeLaunch {
    executable: PathBuf,
    args_prefix: Vec<String>,
    display_path: PathBuf,
}

struct RuntimeState {
    snapshot: AppSnapshot,
    scan_workspace: String,
    capture_handle: Option<BridgeHandle>,
    /// 历史快照缓存：记录上次全量扫描时的 workspace 与输出根目录 mtime，
    /// 目录未变化时跳过重复读盘（get_app_snapshot 轮询高频调用）。
    history_cache: Option<(String, Option<std::time::SystemTime>)>,
    /// 上次目录指纹扫描时刻：递归 mtime 扫描代价高，get_app_snapshot 高频轮询
    /// 时按 HISTORY_SCAN_INTERVAL 节流（无 notify 类文件 watcher 依赖的取舍）。
    last_history_scan: Option<Instant>,
}

#[derive(Clone)]
pub(crate) struct SharedState {
    inner: Arc<Mutex<RuntimeState>>,
    /// connect/disconnect 原子占位标志：CAS 确保同一时刻只有一个连接状态
    /// 切换在进行，消除 check-then-act 竞态（见 `ConnectionOpGuard`）。
    connecting: Arc<AtomicBool>,
    app_data_dir: PathBuf,
}

/// 连接操作的 RAII 占位守卫：`try_acquire` 用 CAS 原子地抢占标志，
/// drop 时无条件释放，保证任何提前返回/panic 路径都不会泄漏占位。
struct ConnectionOpGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> ConnectionOpGuard<'a> {
    fn try_acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
            .then_some(Self { flag })
    }
}

impl Drop for ConnectionOpGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

impl SharedState {
    fn new(app_data_dir: PathBuf) -> Self {
        let scan_workspace = String::new();
        let snapshot = AppSnapshot {
            scan_workspace: scan_workspace.clone(),
            workspace_output_dir: scan_workspace_output_root(&scan_workspace)
                .to_string_lossy()
                .to_string(),
            ..Default::default()
        };
        Self {
            inner: Arc::new(Mutex::new(RuntimeState {
                snapshot,
                scan_workspace,
                capture_handle: None,
                history_cache: None,
                last_history_scan: None,
            })),
            connecting: Arc::new(AtomicBool::new(false)),
            app_data_dir,
        }
    }

    fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/bindings/")]
pub(crate) struct ConnectArgs {
    process_name: String,
    mode: Option<String>,
}

fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn format_modified_time(value: std::time::SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Local> = value.into();
    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn push_log(state: &SharedState, app: &tauri::AppHandle, level: &str, message: impl Into<String>) {
    let message = message.into();
    {
        let mut runtime = state.inner.lock();
        runtime.snapshot.logs.push(LogEntry {
            timestamp: now_string(),
            level: level.to_string(),
            message: message.clone(),
        });
        if runtime.snapshot.logs.len() > 500 {
            let drain = runtime.snapshot.logs.len() - 500;
            runtime.snapshot.logs.drain(0..drain);
        }
    }
    let payload = serde_json::json!({
        "type": "log",
        "level": level,
        "message": message,
        "timestamp": now_string(),
    });
    emit_bridge_event(app, &payload);
}

fn emit_bridge_event(app: &tauri::AppHandle, payload: &Value) {
    let _ = app.emit("bridge-event", payload.clone());
}

// ── 阶段3a：快照事件驱动 ──
// setup 时注册 AppHandle（set_app_handle），此后任何快照数据变化都在锁外
// emit "battle-grabber://snapshot-updated"（payload = 新 version: number）。
// 前端主路径监听该事件按需拉取，替代固定间隔全量轮询。
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub(crate) fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

fn emit_snapshot_updated(version: u64) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("battle-grabber://snapshot-updated", version);
    }
}

/// 快照数据发生变化时递增版本号（调用方需在持有锁时调用，锁外 emit）。
fn bump_snapshot_version(runtime: &mut RuntimeState) -> u64 {
    runtime.snapshot.version = runtime.snapshot.version.saturating_add(1);
    runtime.snapshot.version
}

fn project_root_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current) = std::env::current_dir() {
        candidates.push(current);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.clone());
    if let Some(parent) = manifest_dir.parent() {
        candidates.push(parent.to_path_buf());
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
            if let Some(pp) = parent.parent() {
                candidates.push(pp.to_path_buf());
                if let Some(ppp) = pp.parent() {
                    candidates.push(ppp.to_path_buf());
                }
            }
        }
    }

    candidates
}

fn resolve_v6_root() -> PathBuf {
    for candidate in project_root_candidates() {
        let direct_bridge = candidate
            .join("src-tauri")
            .join("assets")
            .join("frida_bridge.py");
        if direct_bridge.exists() {
            return candidate;
        }

        let nested = candidate
            .join("docs")
            .join("battle-audit")
            .join("battle_grabber_v6")
            .join("src-tauri")
            .join("assets")
            .join("frida_bridge.py");
        if nested.exists() {
            return candidate
                .join("docs")
                .join("battle-audit")
                .join("battle_grabber_v6");
        }
    }

    PathBuf::from(".")
}

fn sanitize_scan_workspace(value: &str) -> String {
    let mut safe = String::new();
    // Truncate by character count (not bytes) so CJK workspace names keep
    // their full 64-character budget.
    for ch in value.trim().chars().take(64) {
        if ch.is_ascii_alphanumeric()
            || matches!(ch, '_' | '-' | '.')
            || ('\u{4e00}'..='\u{9fff}').contains(&ch)
        {
            safe.push(ch);
        } else if ch.is_whitespace() {
            safe.push('_');
        }
    }

    while safe.contains("..") {
        safe = safe.replace("..", ".");
    }
    safe.trim_matches(|ch| matches!(ch, '_' | '-' | '.'))
        .to_string()
}

fn user_writable_output_root() -> PathBuf {
    if let Ok(value) = std::env::var("BATTLE_GRABBER_V6_OUTPUT_ROOT") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if cfg!(debug_assertions) {
        return resolve_v6_root().join("output");
    }

    for env_name in ["LOCALAPPDATA", "APPDATA"] {
        if let Ok(value) = std::env::var(env_name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed)
                    .join("BattleGrabberV6")
                    .join("output");
            }
        }
    }

    resolve_v6_root().join("output")
}

/// Resolve the custom export root without touching process env:
/// external `SMDC_EXPORT_ROOT` override (read-only) first, then the
/// `<app_data_dir>/export_root.txt` file maintained by the database layer.
fn custom_export_root(app_data_dir: &Path) -> Option<PathBuf> {
    if let Ok(value) = std::env::var("SMDC_EXPORT_ROOT") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    let marker = app_data_dir.join("export_root.txt");
    fs::read_to_string(marker)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn scan_workspace_output_root(workspace: &str) -> PathBuf {
    let root = user_writable_output_root();
    let workspace = sanitize_scan_workspace(workspace);
    if workspace.is_empty() {
        root
    } else {
        root.join("workspaces").join(workspace)
    }
}

fn workspace_updated_at(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(format_modified_time)
        .unwrap_or_default()
}

fn workspace_session_count(path: &Path) -> usize {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().join("session_summary.json").exists())
                .count()
        })
        .unwrap_or(0)
}

fn collect_workspace_records(active_workspace: &str) -> Vec<ScanWorkspaceRecord> {
    let active_workspace = sanitize_scan_workspace(active_workspace);
    let output_root = scan_workspace_output_root("");
    let mut records = Vec::new();

    if output_root.exists() {
        records.push(ScanWorkspaceRecord {
            name: String::new(),
            output_dir: output_root.to_string_lossy().to_string(),
            session_count: workspace_session_count(&output_root),
            updated_at: workspace_updated_at(&output_root),
            active: active_workspace.is_empty(),
        });
    }

    let workspaces_root = output_root.join("workspaces");
    if let Ok(entries) = fs::read_dir(&workspaces_root) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry
                .file_name()
                .to_str()
                .map(sanitize_scan_workspace)
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            records.push(ScanWorkspaceRecord {
                name: name.clone(),
                output_dir: path.to_string_lossy().to_string(),
                session_count: workspace_session_count(&path),
                updated_at: workspace_updated_at(&path),
                active: name == active_workspace,
            });
        }
    }

    records.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.name.cmp(&right.name))
    });
    records
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    if path.exists() && path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn resolve_resource_file(app: Option<&tauri::AppHandle>, relative_path: &str) -> Option<PathBuf> {
    app.and_then(|app| {
        app.path()
            .resolve(relative_path, BaseDirectory::Resource)
            .ok()
    })
    .and_then(existing_file)
}

fn executable_neighbor_candidates(relative_path: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(relative_path));
            candidates.push(parent.join("resources").join(relative_path));
        }
    }
    candidates
}

fn resolve_bridge_executable(app: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    if let Ok(value) = std::env::var("BATTLE_GRABBER_BRIDGE_EXE") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            if let Some(path) = existing_file(PathBuf::from(trimmed)) {
                return Some(path);
            }
        }
    }

    let root = resolve_v6_root();
    let development_bridge = root
        .join("src-tauri")
        .join("assets")
        .join("frida_bridge.exe");
    if let Some(path) = existing_file(development_bridge) {
        return Some(path);
    }

    if let Some(path) = resolve_resource_file(app, "assets/frida_bridge.exe") {
        return Some(path);
    }

    for candidate in executable_neighbor_candidates("assets/frida_bridge.exe") {
        if let Some(path) = existing_file(candidate) {
            return Some(path);
        }
    }

    None
}

fn resolve_bridge_script(app: Option<&tauri::AppHandle>) -> PathBuf {
    if let Ok(value) = std::env::var("BATTLE_GRABBER_BRIDGE_PY") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            if let Some(path) = existing_file(PathBuf::from(trimmed)) {
                return path;
            }
        }
    }

    let root = resolve_v6_root();
    let bridge = root
        .join("src-tauri")
        .join("assets")
        .join("frida_bridge.py");
    if bridge.exists() {
        return bridge;
    }

    if let Some(path) = resolve_resource_file(app, "assets/frida_bridge.py") {
        return path;
    }

    for candidate in executable_neighbor_candidates("assets/frida_bridge.py") {
        if let Some(path) = existing_file(candidate) {
            return path;
        }
    }

    bridge
}

fn resolve_python_executable(app: Option<&tauri::AppHandle>) -> PathBuf {
    if let Ok(value) = std::env::var("PYTHON") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    if let Some(path) = resolve_resource_file(app, "assets/python/python.exe") {
        return path;
    }

    for candidate in executable_neighbor_candidates("assets/python/python.exe") {
        if let Some(path) = existing_file(candidate) {
            return path;
        }
    }

    PathBuf::from("python")
}

fn resolve_bridge_launch(app: Option<&tauri::AppHandle>) -> BridgeLaunch {
    if let Some(executable) = resolve_bridge_executable(app) {
        return BridgeLaunch {
            display_path: executable.clone(),
            executable,
            args_prefix: Vec::new(),
        };
    }

    let bridge = resolve_bridge_script(app);
    BridgeLaunch {
        executable: resolve_python_executable(app),
        args_prefix: vec!["-u".to_string(), bridge.to_string_lossy().to_string()],
        display_path: bridge,
    }
}

fn append_bridge_args(command: &mut Command, launch: &BridgeLaunch, args: &[String]) {
    for arg in &launch.args_prefix {
        command.arg(arg);
    }
    for arg in args {
        command.arg(arg);
    }
}

fn json_from_path(path: &Path) -> Option<Value> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&content).ok()
}

fn build_report_record(session_id: &str, item: &Value) -> ReportRecord {
    let txt = item
        .get("txt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let json = item
        .get("json")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let fallback_path = if !json.is_empty() { &json } else { &txt };
    let id = item
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            Path::new(fallback_path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or(session_id)
                .replace(".readable", "")
        });

    let event_count = item
        .get("event_count")
        .or_else(|| item.get("eventCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;

    ReportRecord {
        session_id: session_id.to_string(),
        id,
        txt,
        md: item
            .get("md")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        csv: item
            .get("csv")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        json: json.clone(),
        html: item
            .get("html")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        battle_json: item
            .get("battleJson")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        battle_md: item
            .get("battleMd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        event_count,
        summary: item
            .get("summary")
            .cloned()
            .filter(Value::is_object)
            .unwrap_or(Value::Null),
        battle_details: item
            .get("battleDetails")
            .cloned()
            .filter(Value::is_object)
            .unwrap_or(Value::Null),
    }
}

fn collect_session_records(workspace: &str) -> Vec<SessionRecord> {
    let workspace = sanitize_scan_workspace(workspace);
    let output_root = scan_workspace_output_root(&workspace);
    let source = if workspace.is_empty() {
        "v6".to_string()
    } else {
        format!("v6:{workspace}")
    };
    let sources = vec![(source, output_root)];

    let mut sessions = Vec::new();

    for (source, output_root) in sources {
        if !output_root.exists() {
            continue;
        }

        let read_dir = match fs::read_dir(&output_root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry_result in read_dir {
            let entry = match entry_result {
                Ok(value) => value,
                Err(_) => continue,
            };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let summary_path = path.join("session_summary.json");
            if !summary_path.exists() {
                continue;
            }
            let payload = match json_from_path(&summary_path) {
                Some(value) => value,
                None => continue,
            };

            let session_id = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();

            let process = payload
                .get("process")
                .cloned()
                .and_then(|value| serde_json::from_value::<ProcessInfo>(value).ok());

            let reports = payload
                .get("reports")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| build_report_record(&session_id, item))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            let packet_count = payload
                .get("packet_count")
                .or_else(|| payload.get("packetCount"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .or_else(|| {
                    payload
                        .get("packets")
                        .and_then(Value::as_array)
                        .map(|items| items.len())
                })
                .unwrap_or(0);

            let report_count = payload
                .get("report_count")
                .or_else(|| payload.get("reportCount"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(reports.len());
            let alliance_count = payload
                .get("alliance_count")
                .or_else(|| payload.get("allianceCount"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .or_else(|| {
                    payload
                        .get("alliance_records")
                        .and_then(Value::as_array)
                        .map(|items| items.len())
                })
                .unwrap_or(0);

            sessions.push(SessionRecord {
                id: session_id,
                source: source.clone(),
                output_dir: path.to_string_lossy().to_string(),
                summary_path: summary_path.to_string_lossy().to_string(),
                generated_at: payload
                    .get("generated_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                process,
                installed: payload
                    .get("installed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                packet_count,
                report_count,
                reports,
                alliance_count,
            });
        }
    }

    sessions.sort_by(|a, b| b.generated_at.cmp(&a.generated_at));
    sessions
}

fn latest_alliance_records(workspace: &str) -> Vec<Value> {
    let workspace = sanitize_scan_workspace(workspace);
    let output_root = scan_workspace_output_root(&workspace);
    let persistent_path = output_root
        .join("alliance_protocol")
        .join("alliance_battles.persist.json");
    let mut records_by_key: HashMap<String, Value> = HashMap::new();
    for (index, record) in read_alliance_records_from_path(&persistent_path)
        .into_iter()
        .enumerate()
    {
        let key = alliance_record_key(&record);
        let stable_key = if key.is_empty() {
            format!("{}:{index}", persistent_path.to_string_lossy())
        } else {
            key
        };
        records_by_key.insert(stable_key, record);
    }

    let mut candidate_paths = Vec::new();

    if output_root.exists() {
        let skip_workspace_tree = if workspace.is_empty() {
            Some("workspaces")
        } else {
            None
        };
        if let Ok(entries) = walk_for_named_files(
            &output_root,
            "alliance_battles.latest.json",
            skip_workspace_tree,
        ) {
            candidate_paths.extend(entries);
        }
        if let Ok(entries) = walk_for_named_files(
            &output_root,
            "ocr_alliance_battles.latest.json",
            skip_workspace_tree,
        ) {
            candidate_paths.extend(entries);
        }
    }

    for path in candidate_paths {
        for (index, record) in read_alliance_records_from_path(&path)
            .into_iter()
            .enumerate()
        {
            let key = alliance_record_key(&record);
            let stable_key = if key.is_empty() {
                format!("{}:{index}", path.to_string_lossy())
            } else {
                key
            };
            let should_replace = records_by_key
                .get(&stable_key)
                .map(|existing| {
                    alliance_record_timestamp(&record) > alliance_record_timestamp(existing)
                })
                .unwrap_or(true);
            if should_replace {
                records_by_key.insert(stable_key, record);
            }
        }
    }

    sorted_alliance_records(records_by_key.into_values().collect())
}

fn read_alliance_records_from_path(path: &Path) -> Vec<Value> {
    match json_from_path(path) {
        Some(Value::Array(items)) => items,
        Some(Value::Object(map)) => map
            .get("records")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn alliance_string_field(record: &Value, field: &str) -> String {
    match record.get(field) {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn alliance_record_key(record: &Value) -> String {
    for field in [
        "battleCode",
        "combatCode",
        "blockHash",
        "combatHashKey",
        "recordKey",
    ] {
        let value = alliance_string_field(record, field);
        if !value.is_empty() {
            return value;
        }
    }

    let battle_id = alliance_string_field(record, "battleId");
    if battle_id.is_empty() {
        return String::new();
    }

    [
        alliance_string_field(record, "parentBattleId"),
        battle_id,
        alliance_string_field(record, "index"),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(":")
}

fn alliance_record_timestamp(record: &Value) -> i64 {
    record
        .get("timeStamp")
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
        })
        .unwrap_or(0)
}

fn sorted_alliance_records(mut records: Vec<Value>) -> Vec<Value> {
    records.sort_by(|left, right| {
        alliance_record_timestamp(right)
            .cmp(&alliance_record_timestamp(left))
            .then_with(|| alliance_record_key(right).cmp(&alliance_record_key(left)))
    });
    records
}

fn walk_for_named_files(
    root: &Path,
    target_name: &str,
    skip_root_child: Option<&str>,
) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry_result in fs::read_dir(&dir)? {
            let entry = entry_result?;
            let path = entry.path();
            if path.is_dir() {
                if skip_root_child
                    .and_then(|name| {
                        path.file_name()
                            .and_then(|file_name| file_name.to_str())
                            .map(|file_name| file_name == name)
                    })
                    .unwrap_or(false)
                    && path.parent().map(|parent| parent == root).unwrap_or(false)
                {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name == target_name)
                .unwrap_or(false)
            {
                files.push(path);
            }
        }
    }

    Ok(files)
}

/// 输出根目录的 mtime（目录本身或其下最近修改的入口），用于历史快照缓存判断。
///
/// ⚠️ 采集器运行时会持续重写已有 capture 目录内的 `alliance_protocol/*.json(l)`
/// 与 `reports.index.json(l)`，而 **不改变目录自身的 mtime**（写的是既有文件）。
/// 若指纹只看顶层入口，深层数据文件已更新时指纹不变，会导致 `refresh_runtime_history`
/// 命中缓存、前端停留在旧数据。因此指纹必须递归扫描到数据文件层，取全树最大 mtime。
fn output_root_fingerprint(workspace: &str) -> Option<std::time::SystemTime> {
    let root = scan_workspace_output_root(workspace);
    let meta = fs::metadata(&root).ok()?;
    let mut latest = meta.modified().ok()?;
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            if let Ok(Some(m)) = newest_mtime(entry.path()) {
                if m > latest {
                    latest = m;
                }
            }
        }
    }
    Some(latest)
}

/// 递归取一棵目录树内所有文件/目录的最新 mtime（含深层子目录），
/// 用于缓存指纹判断。读取失败（权限、瞬时 IO 错误）则返回 `Ok(None)` 跳过，
/// 不影响指纹计算。
fn newest_mtime(path: PathBuf) -> std::io::Result<Option<std::time::SystemTime>> {
    let meta = fs::metadata(&path)?;
    let mut latest = meta.modified().ok();
    if meta.is_dir() {
        for entry in fs::read_dir(&path)? {
            let entry = entry?;
            if let Some(m) = newest_mtime(entry.path())? {
                if latest.is_none_or(|current| m > current) {
                    latest = Some(m);
                }
            }
        }
    }
    Ok(latest)
}

fn refresh_history_snapshot(snapshot: &mut AppSnapshot, workspace: &str) {
    let workspace = sanitize_scan_workspace(workspace);
    snapshot.scan_workspace = workspace.clone();
    snapshot.workspace_output_dir = scan_workspace_output_root(&workspace)
        .to_string_lossy()
        .to_string();
    snapshot.sessions = collect_session_records(&workspace);
    snapshot.alliance_records = latest_alliance_records(&workspace);
}

/// 目录指纹扫描的最小间隔：事件驱动改造后仍保留递归 mtime 扫描（未引入
/// notify 等重型依赖），用节流 + 指纹短路控制 IO 代价。
const HISTORY_SCAN_INTERVAL: Duration = Duration::from_millis(1500);

/// 刷新历史快照（sessions/alliance_records 来自输出目录扫描）。
/// 返回 true 表示历史数据发生了实际变化（调用方应 bump 版本号）。
/// `force=true` 跳过时间节流（refresh_history 命令与 workspace 切换用）。
fn refresh_runtime_history(runtime: &mut RuntimeState, force: bool) -> bool {
    let workspace = runtime.scan_workspace.clone();
    // 节流：同一 workspace 距上次扫描不足间隔时直接短路，不做递归 mtime 扫描。
    if !force {
        let same_workspace = runtime
            .history_cache
            .as_ref()
            .is_some_and(|(cached, _)| *cached == workspace);
        if same_workspace
            && runtime
                .last_history_scan
                .is_some_and(|last| last.elapsed() < HISTORY_SCAN_INTERVAL)
        {
            return false;
        }
    }
    let fingerprint = output_root_fingerprint(&workspace);
    // 目录未变化（或 workspace 未切换）时跳过全量扫描，直接复用缓存快照
    if let Some((cached_workspace, cached_fingerprint)) = &runtime.history_cache {
        if *cached_workspace == workspace && *cached_fingerprint == fingerprint {
            runtime.last_history_scan = Some(Instant::now());
            // 记录数统一存于 snapshot（P2-2 Phase 1 起不再有独立的 runtime 计数字段）
            let count = runtime.snapshot.alliance_records.len();
            runtime.snapshot.alliance_record_count = count;
            return false;
        }
    }
    refresh_history_snapshot(&mut runtime.snapshot, &workspace);
    runtime.history_cache = Some((workspace, fingerprint));
    runtime.last_history_scan = Some(Instant::now());
    let count = runtime.snapshot.alliance_records.len();
    runtime.snapshot.alliance_record_count = count;
    true
}

fn set_connection_disconnected(snapshot: &mut AppSnapshot) {
    snapshot.connection.status = "disconnected".to_string();
    snapshot.connection.mode.clear();
    snapshot.connection.session_id.clear();
    snapshot.connection.output_dir.clear();
    snapshot.connection.remote_capture_dir.clear();
    snapshot.connection.installed = false;
    snapshot.connection.process = None;
}

fn handle_bridge_message(state: &SharedState, app: &tauri::AppHandle, payload: Value) {
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // 快照数据是否发生变化：变化时 bump 版本号并在锁外 emit snapshot-updated。
    // 纯日志类消息（"log"）不 bump——日志走 bridge-event 流，避免事件风暴。
    let mut mutated = false;
    let mut version_after_bump = 0u64;
    {
        let mut runtime = state.inner.lock();
        match event_type.as_str() {
            "connected" => {
                runtime.snapshot.connection.status = "connected".to_string();
                runtime.snapshot.connection.mode = payload
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                runtime.snapshot.connection.session_id = payload
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                runtime.snapshot.connection.output_dir = payload
                    .get("outputDir")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                runtime.snapshot.connection.process = Some(ProcessInfo {
                    pid: payload.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32,
                    name: payload
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                });
                runtime.snapshot.packets.clear();
                runtime.snapshot.reports.clear();
                runtime.snapshot.alliance_packets.clear();
                mutated = true;
            }
            "installed" => {
                runtime.snapshot.connection.installed = true;
                runtime.snapshot.connection.remote_capture_dir = payload
                    .get("remoteCaptureDir")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                mutated = true;
            }
            "ready" => {
                runtime.snapshot.connection.status = "ready".to_string();
                if let Some(remote) = payload.get("remoteCaptureDir").and_then(Value::as_str) {
                    runtime.snapshot.connection.remote_capture_dir = remote.to_string();
                }
                mutated = true;
            }
            "packet" => {
                if let Ok(packet) = serde_json::from_value::<PacketRecord>(payload.clone()) {
                    runtime.snapshot.packets.push(packet);
                    if runtime.snapshot.packets.len() > 300 {
                        let drain = runtime.snapshot.packets.len() - 300;
                        runtime.snapshot.packets.drain(0..drain);
                    }
                    mutated = true;
                }
            }
            "report" => {
                if let Ok(report) = serde_json::from_value::<ReportRecord>(payload.clone()) {
                    runtime.snapshot.reports.push(report);
                    if runtime.snapshot.reports.len() > 50 {
                        let drain = runtime.snapshot.reports.len() - 50;
                        runtime.snapshot.reports.drain(0..drain);
                    }
                    mutated = true;
                }
            }
            "alliance_records" => {
                if let Some(records) = payload.get("records").and_then(Value::as_array) {
                    runtime.snapshot.alliance_records = records.clone();
                    let count = runtime.snapshot.alliance_records.len();
                    runtime.snapshot.alliance_record_count = count;
                } else if let Some(count) = payload.get("recordCount").and_then(Value::as_u64) {
                    runtime.snapshot.alliance_record_count = count as usize;
                }
                mutated = true;
            }
            "alliance_packet" => {
                runtime.snapshot.alliance_packets.push(payload.clone());
                if runtime.snapshot.alliance_packets.len() > 200 {
                    let drain = runtime.snapshot.alliance_packets.len() - 200;
                    runtime.snapshot.alliance_packets.drain(0..drain);
                }
                mutated = true;
            }
            "session_summary" => {
                // The summary file can be large once a workspace accumulates many reports.
                // Keep live capture responsive and refresh history on demand / disconnect.
            }
            "disconnected" => {
                if refresh_runtime_history(&mut runtime, false) {
                    bump_snapshot_version(&mut runtime);
                }
                set_connection_disconnected(&mut runtime.snapshot);
                mutated = true;
            }
            _ => {}
        }
        if mutated {
            version_after_bump = bump_snapshot_version(&mut runtime);
        }
    }
    if mutated {
        emit_snapshot_updated(version_after_bump);
    }

    if matches!(
        event_type.as_str(),
        "connected" | "installed" | "ready" | "report" | "disconnected"
    ) {
        emit_bridge_event(app, &payload);
    }

    if event_type == "log" {
        let level = payload
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or("info")
            .to_string();
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let mut runtime = state.inner.lock();
        runtime.snapshot.logs.push(LogEntry {
            timestamp: payload
                .get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            level,
            message,
        });
        if runtime.snapshot.logs.len() > 500 {
            let drain = runtime.snapshot.logs.len() - 500;
            runtime.snapshot.logs.drain(0..drain);
        }
    }
}

fn spawn_stream_reader<R: Read + Send + 'static>(
    reader: R,
    state: SharedState,
    app: tauri::AppHandle,
    source: &'static str,
    is_stderr: bool,
    bridge_pid: u32,
) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        // 用 catch_unwind 包住整个读循环：消息处理/日志链路里的 panic 不再让
        // 读线程静默消失（数据丢失且前端无感知），而是走恢复/兜底路径。
        let loop_state = state.clone();
        let loop_app = app.clone();
        let outcome = catch_unwind(AssertUnwindSafe(move || {
            for line_result in buffered.lines() {
                let line = match line_result {
                    Ok(value) => value,
                    Err(err) => {
                        push_log(
                            &loop_state,
                            &loop_app,
                            "error",
                            format!("Bridge read failed: {err}"),
                        );
                        break;
                    }
                };

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                if is_stderr {
                    push_log(&loop_state, &loop_app, "warn", format!("[{source}] {trimmed}"));
                    continue;
                }

                match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => handle_bridge_message(&loop_state, &loop_app, value),
                    Err(_) => push_log(
                        &loop_state,
                        &loop_app,
                        "info",
                        format!("[{source}] {trimmed}"),
                    ),
                }
            }
        }));

        if outcome.is_err() {
            push_log(
                &state,
                &app,
                "error",
                format!("[{source}] bridge 读线程异常退出，已调度兜底处理"),
            );
            // 复用既有的 8s 强杀兜底：若 bridge 进程仍被登记为活跃 capture，
            // 到期后强杀，避免进程孤儿化/数据静默丢失；进程已正常退出时
            // 守卫会自行跳过。
            schedule_force_kill(&state, &app, source, bridge_pid);
        }
    });
}

fn spawn_bridge_process(
    state: &SharedState,
    app: &tauri::AppHandle,
    source: &'static str,
    args: &[String],
) -> Result<(Child, BridgeHandle), String> {
    let launch = resolve_bridge_launch(Some(app));
    let workspace = {
        let runtime = state.inner.lock();
        runtime.scan_workspace.clone()
    };
    let output_root = scan_workspace_output_root(&workspace);

    let mut command = Command::new(&launch.executable);
    append_bridge_args(&mut command, &launch, args);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.env(
        "BATTLE_GRABBER_WORKSPACE",
        sanitize_scan_workspace(&workspace),
    );
    command.env("BATTLE_GRABBER_OUTPUT_ROOT", output_root);
    hide_subprocess_window(&mut command);

    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("Failed to capture bridge stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture bridge stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture bridge stderr")?;
    let handle = BridgeHandle {
        pid,
        stdin: Arc::new(Mutex::new(Some(stdin))),
    };

    spawn_stream_reader(stdout, state.clone(), app.clone(), source, false, pid);
    spawn_stream_reader(stderr, state.clone(), app.clone(), source, true, pid);
    Ok((child, handle))
}

fn request_bridge_stop(handle: &BridgeHandle) -> Result<(), String> {
    let mut stdin = handle.stdin.lock();
    let bridge_stdin = stdin.as_mut().ok_or("Bridge stdin unavailable")?;
    bridge_stdin
        .write_all(b"stop\n")
        .and_then(|_| bridge_stdin.flush())
        .map_err(|err| err.to_string())
}

fn schedule_force_kill(
    state: &SharedState,
    app: &tauri::AppHandle,
    source: &'static str,
    pid: u32,
) {
    let shared = state.clone();
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(8));

        let should_kill = {
            let runtime = shared.inner.lock();
            match source {
                "capture" => runtime
                    .capture_handle
                    .as_ref()
                    .map(|handle| handle.pid == pid)
                    .unwrap_or(false),
                _ => false,
            }
        };

        if should_kill {
            kill_pid(pid);
            push_log(
                &shared,
                &app_handle,
                "warn",
                format!("{source} bridge did not exit after stop request; forced kill"),
            );
        }
    });
}

fn kill_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        hide_subprocess_window(&mut command);
        let _ = command.output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
}

fn monitor_bridge_process(
    mut child: Child,
    state: SharedState,
    app: tauri::AppHandle,
    source: &'static str,
    pid: u32,
) {
    thread::spawn(move || {
        let status = child.wait();
        let mut disconnected = false;
        let mut version = 0u64;
        {
            let mut runtime = state.inner.lock();
            if source == "capture"
                && runtime
                    .capture_handle
                    .as_ref()
                    .map(|handle| handle.pid == pid)
                    .unwrap_or(false)
            {
                runtime.capture_handle = None;
                set_connection_disconnected(&mut runtime.snapshot);
                version = bump_snapshot_version(&mut runtime);
                disconnected = true;
            }
        }
        if disconnected {
            emit_snapshot_updated(version);
        }

        push_log(
            &state,
            &app,
            "info",
            format!(
                "{source} bridge exited{}",
                status
                    .ok()
                    .and_then(|value| value.code())
                    .map(|code| format!(" with code {code}"))
                    .unwrap_or_default()
            ),
        );
    });
}

#[tauri::command]
pub(crate) fn get_bridge_path_cmd(app: tauri::AppHandle) -> String {
    resolve_bridge_launch(Some(&app))
        .display_path
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub(crate) fn get_app_snapshot(
    state: State<'_, SharedState>,
    since_version: Option<u64>,
) -> AppSnapshotResponse {
    let mut runtime = state.inner.lock();
    let history_bumped = refresh_runtime_history(&mut runtime, false);
    if history_bumped {
        bump_snapshot_version(&mut runtime);
    }
    let version = runtime.snapshot.version;
    // since_version 缺省视为首次拉取，返回全量；否则仅在版本前进时携带快照。
    let changed = history_bumped || since_version.is_none_or(|since| version > since);
    let snapshot = if changed {
        Some(runtime.snapshot.clone())
    } else {
        None
    };
    drop(runtime);
    if history_bumped {
        emit_snapshot_updated(version);
    }
    AppSnapshotResponse {
        changed,
        version,
        snapshot,
    }
}

#[tauri::command]
pub(crate) fn get_live_capture_snapshot(state: State<'_, SharedState>) -> LiveCaptureSnapshot {
    let runtime = state.inner.lock();
    LiveCaptureSnapshot {
        scan_workspace: runtime.snapshot.scan_workspace.clone(),
        workspace_output_dir: runtime.snapshot.workspace_output_dir.clone(),
        connection: runtime.snapshot.connection.clone(),
        logs: runtime.snapshot.logs.clone(),
        packets: runtime.snapshot.packets.clone(),
        reports: runtime.snapshot.reports.clone(),
        alliance_record_count: runtime.snapshot.alliance_record_count,
    }
}

/// 按需拉取同盟战报记录（P2-2 Phase 1）。
///
/// 之前 `alliance_records` 随 `get_app_snapshot` / `get_live_capture_snapshot` 每次
/// 整包下发；改为由前端在「记录条数变化 / 切换工作区」时调用本命令拉取一次。
/// 命中当前 runtime 缓存时直接返回缓存，否则按 workspace 重新扫描输出目录。
#[tauri::command]
pub(crate) fn get_alliance_records(
    state: State<'_, SharedState>,
    scan_workspace: Option<String>,
) -> Vec<Value> {
    let requested = sanitize_scan_workspace(scan_workspace.as_deref().unwrap_or_default());
    {
        let runtime = state.inner.lock();
        if requested == runtime.snapshot.scan_workspace && !runtime.snapshot.alliance_records.is_empty() {
            return runtime.snapshot.alliance_records.clone();
        }
    }
    latest_alliance_records(&requested)
}

#[tauri::command]
pub(crate) fn refresh_history(state: State<'_, SharedState>) -> AppSnapshot {
    let mut runtime = state.inner.lock();
    // 显式强制刷新：绕过扫描节流（仍走指纹短路，目录无变化不重读盘）。
    let history_changed = refresh_runtime_history(&mut runtime, true);
    let version = if history_changed {
        Some(bump_snapshot_version(&mut runtime))
    } else {
        None
    };
    let snapshot = runtime.snapshot.clone();
    drop(runtime);
    if let Some(version) = version {
        emit_snapshot_updated(version);
    }
    snapshot
}

#[tauri::command]
pub(crate) fn list_scan_workspaces(state: State<'_, SharedState>) -> Vec<ScanWorkspaceRecord> {
    let runtime = state.inner.lock();
    collect_workspace_records(&runtime.scan_workspace)
}

#[tauri::command]
pub(crate) fn set_scan_workspace(
    state: State<'_, SharedState>,
    workspace: String,
) -> Result<AppSnapshot, String> {
    let workspace = sanitize_scan_workspace(&workspace);
    let mut runtime = state.inner.lock();
    if runtime.capture_handle.is_some() {
        return Err("Stop capture before switching scan workspace".to_string());
    }

    runtime.scan_workspace = workspace.clone();
    runtime.snapshot.packets.clear();
    runtime.snapshot.reports.clear();
    runtime.snapshot.alliance_packets.clear();
    // workspace 切换强制重扫历史（绕过节流）；切换本身就是快照变化，无条件 bump。
    refresh_runtime_history(&mut runtime, true);
    let version = bump_snapshot_version(&mut runtime);
    let snapshot = runtime.snapshot.clone();
    drop(runtime);
    emit_snapshot_updated(version);
    Ok(snapshot)
}

/// 带超时地运行一个子进程并收集输出。
/// P1-1：此前 `list_processes` 用 `command.output()` 且**没有任何超时**，
/// 一旦 bridge 或 `py` 启动器卡住就永久阻塞（同步命令还会阻塞 UI 线程）。
/// 这里改为轮询 `try_wait`，超时按进程树回收，再读取已关闭的管道。
fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
    label: &str,
) -> Result<std::process::Output, String> {
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait().map_err(|err| err.to_string())? {
            Some(_) => break,
            None => {
                if Instant::now() >= deadline {
                    crate::proc_util::kill_process_tree(child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "{label} 超过 {}s 未返回，已终止子进程",
                        timeout.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    child.wait_with_output().map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) async fn list_processes(app: tauri::AppHandle) -> Result<Vec<ProcessInfo>, String> {
    // 放到阻塞线程池执行：这条命令要拉起 bridge 进程，不能占用 UI 线程。
    tauri::async_runtime::spawn_blocking(move || list_processes_blocking(&app))
        .await
        .map_err(|err| err.to_string())?
}

fn list_processes_blocking(app: &tauri::AppHandle) -> Result<Vec<ProcessInfo>, String> {
    let launch = resolve_bridge_launch(Some(app));
    let mut command = Command::new(&launch.executable);
    append_bridge_args(&mut command, &launch, &["list".to_string()]);
    hide_subprocess_window(&mut command);
    let output = run_command_with_timeout(command, Duration::from_secs(30), "bridge list")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!(
                "Bridge exited with status {}",
                output.status.code().unwrap_or(-1)
            ));
        }
        return Err(stderr);
    }

    serde_json::from_slice::<Vec<ProcessInfo>>(&output.stdout).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn connect_process(
    state: State<'_, SharedState>,
    app: tauri::AppHandle,
    args: ConnectArgs,
) -> Result<String, String> {
    let mode = args.mode.unwrap_or_else(|| "passive".to_string());
    let bridge_mode = if mode == "legacy" {
        "legacy".to_string()
    } else {
        "passive".to_string()
    };

    // 原子占位：CAS 抢占连接操作标志，消除并发 connect/connect、
    // connect/disconnect 的 check-then-act 竞态；守卫保证任何提前返回
    // 路径都会释放占位。
    let _op_guard = ConnectionOpGuard::try_acquire(&state.connecting)
        .ok_or_else(|| "A connect or disconnect operation is already in progress".to_string())?;

    {
        let runtime = state.inner.lock();
        if runtime.capture_handle.is_some() {
            return Err("A capture process is already running".to_string());
        }
    }

    push_log(
        &state,
        &app,
        "info",
        format!("Starting {mode} capture for {}", args.process_name),
    );

    let (child, handle) = spawn_bridge_process(
        &state,
        &app,
        "capture",
        &[bridge_mode, args.process_name.clone()],
    )?;
    let pid = handle.pid;

    {
        let mut runtime = state.inner.lock();
        // 若等待期间已有 disconnect 抢先登记过状态，此处仍以本次启动为准：
        // 进程已真实存在，必须登记 handle，否则监控/强杀链路会丢失它。
        runtime.capture_handle = Some(handle);
        runtime.snapshot.connection.status = "connecting".to_string();
        runtime.snapshot.connection.mode = mode;
        runtime.snapshot.connection.process = Some(ProcessInfo {
            pid: 0,
            name: args.process_name,
        });
        runtime.snapshot.packets.clear();
        runtime.snapshot.reports.clear();
        emit_snapshot_updated(bump_snapshot_version(&mut runtime));
    }
    let shared = state.inner().clone();
    monitor_bridge_process(child, shared, app.clone(), "capture", pid);

    Ok("Capture started".to_string())
}

#[tauri::command]
pub(crate) fn disconnect_process(
    state: State<'_, SharedState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // 与 connect_process 共用同一原子占位标志：连接状态切换互斥，
    // 消除并发 connect/disconnect 的竞态。
    let _op_guard = ConnectionOpGuard::try_acquire(&state.connecting)
        .ok_or_else(|| "A connect or disconnect operation is already in progress".to_string())?;

    let maybe_handle = {
        let mut runtime = state.inner.lock();
        let handle = runtime.capture_handle.clone();
        if handle.is_some() {
            runtime.snapshot.connection.status = "disconnecting".to_string();
        } else {
            set_connection_disconnected(&mut runtime.snapshot);
        }
        emit_snapshot_updated(bump_snapshot_version(&mut runtime));
        handle
    };

    if let Some(handle) = maybe_handle {
        if let Err(err) = request_bridge_stop(&handle) {
            push_log(
                &state,
                &app,
                "warn",
                format!("Capture stop request failed: {err}"),
            );
            kill_pid(handle.pid);
        } else {
            schedule_force_kill(&state, &app, "capture", handle.pid);
        }
    }

    push_log(&state, &app, "info", "Capture stop requested");
    Ok("Capture stop requested".to_string())
}

fn is_path_within_allowed_dirs(path: &Path, app_data_dir: &Path) -> bool {
    let mut allowed_roots: Vec<PathBuf> = vec![user_writable_output_root(), scan_workspace_output_root("")];
    if let Some(root) = custom_export_root(app_data_dir) {
        allowed_roots.push(root);
    }
    for root in &allowed_roots {
        if let Ok(root_canonical) = root.canonicalize() {
            if let Ok(path_canonical) = path.canonicalize() {
                if path_canonical.starts_with(&root_canonical) {
                    return true;
                }
            }
        }
    }
    false
}

#[tauri::command]
pub(crate) fn read_json_file(path: String, state: State<'_, SharedState>) -> Result<Value, String> {
    if path.len() > 1024 {
        return Err("Path too long".to_string());
    }
    let path = PathBuf::from(&path);
    if !is_path_within_allowed_dirs(&path, state.app_data_dir()) {
        return Err("Access denied: path outside allowed directories".to_string());
    }
    json_from_path(&path).ok_or_else(|| "Failed to read JSON file".to_string())
}

#[tauri::command]
pub(crate) fn read_text_file(
    path: String,
    state: State<'_, SharedState>,
) -> Result<String, String> {
    if path.len() > 1024 {
        return Err("Path too long".to_string());
    }
    let path = PathBuf::from(&path);
    if !is_path_within_allowed_dirs(&path, state.app_data_dir()) {
        return Err("Access denied: path outside allowed directories".to_string());
    }
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn battle_grabber_write_text_export(
    state: State<'_, SharedState>,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let workspace = {
        let runtime = state.inner.lock();
        runtime.scan_workspace.clone()
    };
    let output_dir = custom_export_root(state.app_data_dir())
        .unwrap_or_else(|| scan_workspace_output_root(&workspace))
        .join("exports");
    fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
    let filename = sanitize_export_filename(&filename);
    let output_path = output_dir.join(filename);
    fs::write(&output_path, contents).map_err(|err| err.to_string())?;
    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn battle_grabber_open_path(
    path: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }
    if !is_path_within_allowed_dirs(&path, state.app_data_dir()) {
        return Err("Access denied: path outside allowed directories".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        command.arg(&path);
        hide_subprocess_window(&mut command);
        command.spawn().map_err(|err| err.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

pub(crate) fn initialize() {
    let _ = env_logger::try_init();
}

pub(crate) fn new_state(app_data_dir: PathBuf) -> SharedState {
    SharedState::new(app_data_dir)
}

fn sanitize_export_filename(value: &str) -> String {
    let fallback = "battle_grabber_export.csv";
    let raw_name = Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(fallback);
    let mut safe = String::new();
    for ch in raw_name.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            safe.push('_');
        } else {
            safe.push(ch);
        }
    }
    let safe = safe
        .trim_matches(|ch| matches!(ch, ' ' | '.' | '_'))
        .to_string();
    if safe.is_empty() {
        return fallback.to_string();
    }
    // P2-4 修复：扩展名白名单——只允许纯数据/文档后缀，杜绝写出 .bat/.cmd/.py
    // 等可执行/脚本文件（配合 explorer 打开目录形成钓鱼/执行链）。
    const ALLOWED_EXTS: [&str; 5] = [".json", ".csv", ".txt", ".md", ".html"];
    let lower = safe.to_ascii_lowercase();
    if ALLOWED_EXTS.iter().any(|ext| lower.ends_with(ext)) {
        safe
    } else if let Some(dot) = safe.rfind('.') {
        // 非白名单后缀：剥掉扩展名后追加默认 .csv
        format!("{}.csv", &safe[..dot])
    } else {
        // 无扩展名：追加 .csv
        format!("{safe}.csv")
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_export_filename, sanitize_scan_workspace};

    #[test]
    fn sanitize_scan_workspace_truncates_by_chars_not_bytes() {
        let long_cjk = "谋".repeat(80);
        let sanitized = sanitize_scan_workspace(&long_cjk);
        assert_eq!(sanitized.chars().count(), 64);

        let mixed = format!("{}-军团", "a".repeat(70));
        assert_eq!(sanitize_scan_workspace(&mixed).chars().count(), 64);
    }

    #[test]
    fn sanitize_export_filename_strips_illegal_and_traversal() {
        // Windows 非法字符替换为下划线
        assert_eq!(sanitize_export_filename("report:1?.csv"), "report_1_.csv");
        assert_eq!(sanitize_export_filename("a<b>c|csv"), "a_b_c_csv.csv");
        // 路径穿越只取 basename，反斜杠/正斜杠被剥离
        assert_eq!(sanitize_export_filename("..\\..\\evil.csv"), "evil.csv");
        assert_eq!(sanitize_export_filename("../../evil.csv"), "evil.csv");
        // 纯点/空格/下划线退化为默认名
        assert_eq!(sanitize_export_filename("...."), "battle_grabber_export.csv");
        assert_eq!(sanitize_export_filename("___"), "battle_grabber_export.csv");
        // 中文与常规文件名保留
        assert_eq!(sanitize_export_filename("正常导出.csv"), "正常导出.csv");
        assert_eq!(sanitize_export_filename("a/b/c.txt"), "c.txt");
        // P2-4：白名单外扩展名被剥离并追加 .csv，杜绝 .bat/.cmd/.py 可执行文件
        assert_eq!(sanitize_export_filename("evil.bat"), "evil.csv");
        assert_eq!(sanitize_export_filename("payload.cmd"), "payload.csv");
        assert_eq!(sanitize_export_filename("run.py"), "run.csv");
        assert_eq!(sanitize_export_filename("noext"), "noext.csv");
        assert_eq!(sanitize_export_filename("正常导出.md"), "正常导出.md");
        assert_eq!(sanitize_export_filename("正常导出.json"), "正常导出.json");
        assert_eq!(sanitize_export_filename("正常导出.html"), "正常导出.html");
    }
}
