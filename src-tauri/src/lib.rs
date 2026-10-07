mod battle_grabber;
mod collector;
mod collector_sidecar;
mod db;
mod proc_util;
mod error;
mod models;

use collector::{runtime_probe_enabled, Collector};
use db::Database;
use error::{AppError, AppResult};
use models::{
    AppBundle, CollectorCaptureAck, CollectorStatus, CreateWorkspaceRequest,
    CreateWorkspaceResponse, ExportBattleReportRequest, ExportDirectoryInfo, ExportResult,
    SaveLineupProfileRequest, SaveMemberBindingRequest, StartCaptureRequest, StartCaptureResponse,
    StopCaptureResponse, WorkspaceRecord, WorkspaceSummary,
};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};

#[derive(Debug, Clone)]
struct AppState {
    database: Database,
    collector: Collector,
}

#[tauri::command]
fn get_workspace_summary(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<WorkspaceSummary> {
    state.database.summary(workspace_id)
}

#[tauri::command]
fn get_app_bundle(workspace_id: Option<i64>, state: State<'_, AppState>) -> AppResult<AppBundle> {
    // 阶段3a 起前端 IPC 只拿瘦身 bundle（summary + 小表元数据）；
    // 战报/日志/快照大表改走 get_battle_reports_paged / get_alliance_logs_paged /
    // get_member_snapshots 分片命令；全量 bundle 仅导出/备份内部使用。
    state.database.app_bundle_summary(workspace_id)
}

#[tauri::command]
fn list_workspaces(state: State<'_, AppState>) -> AppResult<Vec<WorkspaceRecord>> {
    state.database.list_workspaces()
}

#[tauri::command]
fn create_workspace(
    request: CreateWorkspaceRequest,
    state: State<'_, AppState>,
) -> AppResult<CreateWorkspaceResponse> {
    state.database.create_workspace(request)
}

#[tauri::command]
fn get_collector_status(state: State<'_, AppState>) -> CollectorStatus {
    state.collector.status()
}

#[tauri::command]
async fn start_capture_session(
    request: StartCaptureRequest,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<StartCaptureResponse> {
    let app_state = state.inner().clone();
    if !runtime_probe_enabled() {
        return Err(AppError::Message(
            "未启用 runtime probe，已禁止创建 preview/样本采集会话；请设置 SMDC_RUNTIME_PROBE=command 后再采集".to_string(),
        ));
    }
    if !app_state.collector.try_acquire() {
        return Err(AppError::Message(
            "collector 正在执行上一轮采集，请等待完成后再开始新的采集".to_string(),
        ));
    }

    let response = match app_state.database.start_pending_capture_session(
        &request,
        "runtime_probe",
        "采集会话已启动，后台正在执行 runtime hook + dump",
    ) {
        Ok(response) => response,
        Err(error) => {
            app_state.collector.release();
            return Err(error);
        }
    };
    let session_id = response.session_id;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Releases the busy flag on every exit path, including panics.
        struct BusyGuard(Collector);
        impl Drop for BusyGuard {
            fn drop(&mut self) {
                self.0.release();
            }
        }
        let _busy_guard = BusyGuard(app_state.collector.clone());

        // P0-1：采集线程 panic 兜底——任何 panic 都不可让会话永久悬挂在 running。
        // 捕获 unwind 后关闭数据库中该会话为 failed，并通知前端采集已结束。
        let unwind_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let sidecar_ack = match app_state.collector.start_capture(&request.capture_type) {
                Ok(ack) => ack,
                Err(error) => CollectorCaptureAck {
                    status: Some("failed".to_string()),
                    message: format!("collector sidecar 启动失败：{error}"),
                    session_id: None,
                    payload: Some(serde_json::json!({
                        "collectorMode": "sidecar_error",
                        "captureType": request.capture_type.clone(),
                        "error": error.to_string(),
                    })),
                },
            };
            // 采集成败判定：collector ack 状态为 failed 即失败（含 sidecar 启动失败分支）。
            let capture_failed = sidecar_ack.status.as_deref() == Some("failed");
            let ack_message = sidecar_ack.message.clone();
            let finish_result = app_state
                .database
                .finish_capture_session(session_id, request, sidecar_ack);
            let (ok, error) = match finish_result {
                Ok(()) if capture_failed => (false, Some(ack_message)),
                Ok(()) => (true, None),
                Err(error) => {
                    eprintln!("failed to finish capture session {session_id}: {error}");
                    (false, Some(error.to_string()))
                }
            };
            // 阶段3a：成功与失败路径都通知前端采集已结束，代替轮询会话状态。
            let _ = app_handle.emit(
                "capture-session-finished",
                models::CaptureSessionFinished {
                    session_id,
                    ok,
                    error,
                },
            );
        }));

        if let Err(panic_payload) = unwind_result {
            // 采集线程 panic：将会话标记为 failed，保证 UI 不被永久"采集中"卡死。
            eprintln!("capture thread panicked for session {session_id}: {panic_payload:?}");
            let fail_result = app_state
                .database
                .fail_running_capture_sessions("采集线程异常退出（panic），会话已强制关闭");
            if let Err(error) = fail_result {
                eprintln!("failed to fail running capture sessions after panic: {error}");
            }
            let _ = app_handle.emit(
                "capture-session-finished",
                models::CaptureSessionFinished {
                    session_id,
                    ok: false,
                    error: Some("采集线程异常退出（panic），会话已强制关闭".to_string()),
                },
            );
        }
    });
    Ok(response)
}

#[tauri::command]
fn stop_capture_session(state: State<'_, AppState>) -> AppResult<StopCaptureResponse> {
    let closed_sessions = state
        .database
        .stop_running_capture_sessions("用户停止采集")?;
    // P0-3：stop_capture 内部改为阻塞式持锁，确保与 ensure_running 互斥，
    // 不再出现"停止失败但 sidecar 进程仍残留"的竞态窗口。
    let stopped = state.collector.stop_capture()?;
    // P0-1 兜底：即便 collector 停止失败（如内部竞态/进程已死但未清理），
    // 会话也已在上面关闭为 stopped；此处不再需要额外 fail 路径。
    let message = match (stopped, closed_sessions) {
        (true, 0) => "已停止采集进程，没有发现仍在运行的采集会话".to_string(),
        (true, count) => format!("已停止采集进程，并关闭 {count} 个运行中的采集会话"),
        (false, count) if count > 0 => {
            format!("未发现采集进程，但已关闭 {count} 个运行中的采集会话")
        }
        (false, _) => "当前没有正在运行的采集".to_string(),
    };
    Ok(StopCaptureResponse {
        stopped,
        closed_sessions,
        message,
    })
}

#[tauri::command]
fn save_member_binding(
    request: SaveMemberBindingRequest,
    state: State<'_, AppState>,
) -> AppResult<models::MemberBindingRow> {
    state.database.save_member_binding(request)
}

#[tauri::command]
fn save_member_bindings(
    requests: Vec<SaveMemberBindingRequest>,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    state.database.save_member_bindings(&requests)
}

#[tauri::command]
fn save_lineup_profile(
    request: SaveLineupProfileRequest,
    state: State<'_, AppState>,
) -> AppResult<models::LineupProfileRow> {
    state.database.save_lineup_profile(request)
}

#[tauri::command]
fn upsert_lineup_stat(
    request: models::UpsertLineupStatRequest,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.database.upsert_lineup_stat(&request)
}

#[tauri::command]
fn upsert_lineup_stats(
    requests: Vec<models::UpsertLineupStatRequest>,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    state.database.upsert_lineup_stats(&requests)
}

#[tauri::command]
fn upsert_lineup_matchup(
    request: models::LineupMatchupInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.database.upsert_lineup_matchup(&request)
}

#[tauri::command]
fn upsert_lineup_matchups(
    requests: Vec<models::LineupMatchupInput>,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    state.database.upsert_lineup_matchups(&requests)
}

#[tauri::command]
fn get_comparison_stats(
    workspace_id: i64,
    from_date: String,
    to_date: String,
    state: State<'_, AppState>,
) -> AppResult<models::ComparisonStats> {
    state
        .database
        .query_comparison_stats(workspace_id, &from_date, &to_date)
}

#[tauri::command]
fn get_member_activity_alerts(
    workspace_id: i64,
    offline_days: i64,
    bottom_n: i64,
    state: State<'_, AppState>,
) -> AppResult<models::MemberActivityAlerts> {
    state
        .database
        .query_member_activity_alerts(workspace_id, offline_days, bottom_n)
}

#[tauri::command]
fn get_cross_workspace_power_series(
    state: State<'_, AppState>,
) -> AppResult<Vec<models::CrossWorkspacePowerPoint>> {
    state.database.query_cross_workspace_power_series()
}

/// 阶段3a 分片命令：战报分页查询。from/to 为 RFC3339 时间戳字符串，语义 [from, to)，
/// None 表示不限；limit 后端钳制到 [1, 500]。
#[tauri::command]
fn get_battle_reports_paged(
    workspace_id: i64,
    from: Option<String>,
    to: Option<String>,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> AppResult<models::PagedBattleReports> {
    state.database.query_battle_reports_paged(
        workspace_id,
        from.as_deref(),
        to.as_deref(),
        limit,
        offset,
    )
}

/// 阶段3a 分片命令：同盟日志分页查询。section 为可选 log_section 等值过滤。
#[tauri::command]
fn get_alliance_logs_paged(
    workspace_id: i64,
    section: Option<String>,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> AppResult<models::PagedAllianceLogs> {
    state
        .database
        .query_alliance_logs_paged(workspace_id, section.as_deref(), limit, offset)
}

/// 阶段3a 分片命令：成员快照分页查询。latest_only=true 只返回每人最新一条快照。
#[tauri::command]
fn get_member_snapshots(
    workspace_id: i64,
    latest_only: bool,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> AppResult<models::PagedMemberSnapshots> {
    state
        .database
        .query_member_snapshots_paged(workspace_id, latest_only, limit, offset)
}

/// 同盟情报快照分页查询。kind 为 None/空时返回全部类型
/// （server_rank / hero_rating / season_team / player_profile / union_building / union_history）。
#[tauri::command]
fn get_intel_snapshots(
    workspace_id: i64,
    kind: Option<String>,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> AppResult<models::PagedIntelSnapshots> {
    state
        .database
        .query_intel_snapshots_paged(workspace_id, kind.as_deref(), limit, offset)
}

/// 情报快照明细分页查询（榜单名次 / 战队成员 / 武将红度行）。
#[tauri::command]
fn get_intel_entries(
    workspace_id: i64,
    snapshot_id: i64,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> AppResult<models::PagedIntelEntries> {
    state
        .database
        .query_intel_entries(workspace_id, snapshot_id, limit, offset)
}

#[tauri::command]
fn backup_data(
    target_dir: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<models::BackupResult> {
    state.database.backup_data(target_dir.as_deref().map(Path::new))
}

#[tauri::command]
fn restore_data(
    backup_dir: String,
    state: State<'_, AppState>,
) -> AppResult<models::RestoreResult> {
    state.database.restore_data(Path::new(&backup_dir))
}

#[tauri::command]
fn get_lineup_analysis(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<models::LineupAnalysisBundle> {
    state.database.query_lineup_analysis(workspace_id)
}

#[tauri::command]
fn save_lineup_stat_notes(
    stat_id: i64,
    notes: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.database.save_lineup_stat_notes(stat_id, &notes)
}

#[tauri::command]
fn delete_lineup_stat(stat_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.database.delete_lineup_stat(stat_id)
}

#[tauri::command]
fn delete_capture_session(
    session_id: i64,
    workspace_id: i64,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.database.delete_capture_session(session_id, workspace_id)
}

#[tauri::command]
fn get_export_directory(state: State<'_, AppState>) -> AppResult<ExportDirectoryInfo> {
    state.database.export_directory_info()
}

#[tauri::command]
fn set_export_directory(path: String, state: State<'_, AppState>) -> AppResult<ExportDirectoryInfo> {
    state.database.set_export_directory(Path::new(&path))
}

#[tauri::command]
fn reset_export_directory(state: State<'_, AppState>) -> AppResult<ExportDirectoryInfo> {
    state.database.reset_export_directory()
}

#[tauri::command]
fn pick_export_directory(state: State<'_, AppState>) -> AppResult<ExportDirectoryInfo> {
    let current = state.database.export_directory_info()?;
    let mut dialog = rfd::FileDialog::new().set_title("选择导出目录");
    if !current.path.trim().is_empty() {
        dialog = dialog.set_directory(&current.path);
    }
    let picked = dialog.pick_folder();
    match picked {
        Some(path) => state.database.set_export_directory(&path),
        None => Ok(current),
    }
}

#[tauri::command]
fn export_alliance_member_data_csv(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_alliance_member_data_csv(workspace_id)?;
    Ok(ExportResult {
        kind: "alliance_member_data".to_string(),
        format: "csv".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_bundle_json(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_bundle_json(workspace_id)?;
    Ok(ExportResult {
        kind: "bundle".to_string(),
        format: "json".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_bundle_csv(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let paths = state.database.export_bundle_csv(workspace_id)?;
    Ok(ExportResult {
        kind: "bundle".to_string(),
        format: "csv".to_string(),
        paths: paths
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
    })
}

#[tauri::command]
fn export_bundle_html(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_bundle_html(workspace_id)?;
    Ok(ExportResult {
        kind: "bundle".to_string(),
        format: "html".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_bundle_xlsx(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_bundle_xlsx(workspace_id)?;
    Ok(ExportResult {
        kind: "bundle".to_string(),
        format: "xlsx".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_lineup_library_json(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_lineup_library_json(workspace_id)?;
    Ok(ExportResult {
        kind: "lineup_library".to_string(),
        format: "json".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_lineup_library_csv(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_lineup_library_csv(workspace_id)?;
    Ok(ExportResult {
        kind: "lineup_library".to_string(),
        format: "csv".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_lineup_library_html(
    workspace_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state.database.export_lineup_library_html(workspace_id)?;
    Ok(ExportResult {
        kind: "lineup_library".to_string(),
        format: "html".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_battle_report_json(
    workspace_id: Option<i64>,
    request: ExportBattleReportRequest,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state
        .database
        .export_battle_report_json(workspace_id, &request.battle_code)?;
    Ok(ExportResult {
        kind: "battle_report".to_string(),
        format: "json".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

#[tauri::command]
fn export_battle_report_html(
    workspace_id: Option<i64>,
    request: ExportBattleReportRequest,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let path = state
        .database
        .export_battle_report_html(workspace_id, &request.battle_code)?;
    Ok(ExportResult {
        kind: "battle_report".to_string(),
        format: "html".to_string(),
        paths: vec![path.to_string_lossy().to_string()],
    })
}

pub fn run() {
    // SAFETY: `set_var` is unsafe under multi-threaded access; runs once at startup
    // before the Tauri event loop spawns worker threads.
    std::env::set_var("SMDC_COLLECTOR_NATIVE_SIDECAR", "1");
    // 2026-08-04 修复：系统存在 GameViewer Virtual Display Adapter（网易UU远程的虚拟显卡
    // 驱动），会导致 WebView2 的 GPU 进程反复崩溃（exit_code=1 崩 6 次后 FATAL
    // "GPU process isn't usable"），窗口空白。强制 GPU 进程并入主进程 + 禁用 GPU 合成 +
    // SwiftShader 软件渲染可稳定绕过。若以后换掉虚拟显卡驱动可删除此段。
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--in-process-gpu --disable-gpu-compositing --use-angle=swiftshader",
    );
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build());
            }
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("output/app-data"));
            if std::env::var_os("SMDC_RUNTIME_SCAN_OUT").is_none() {
                // SAFETY: `set_var` is not thread-safe; runs once during `setup` before
                // the app finishes initializing and spawns worker threads.
                std::env::set_var(
                    "SMDC_RUNTIME_SCAN_OUT",
                    app_data_dir.join("runtime-captures"),
                );
            }
            #[cfg(all(windows, not(debug_assertions)))]
            if std::env::var_os("SMDC_RUNTIME_PROBE").is_none() {
                // SAFETY: `set_var` is not thread-safe; runs once during `setup` before
                // worker threads are spawned.
                std::env::set_var("SMDC_RUNTIME_PROBE", "command");
            }
            if std::env::var_os("BATTLE_GRABBER_V6_OUTPUT_ROOT").is_none() {
                // SAFETY: `set_var` is not thread-safe; runs once during `setup` before
                // worker threads are spawned.
                std::env::set_var(
                    "BATTLE_GRABBER_V6_OUTPUT_ROOT",
                    app_data_dir.join("battle-grabber-v6").join("output"),
                );
            }
            battle_grabber::initialize();
            // 阶段3a：battle-grabber 模块持有 AppHandle，用于快照变化时
            // emit "battle-grabber://snapshot-updated" 事件。
            battle_grabber::set_app_handle(app.handle().clone());
            if let Err(error) = db::apply_pending_restore(&app_data_dir) {
                eprintln!("failed to apply pending restore: {error}");
            }
            let database = Database::new(app_data_dir.clone())?;
            let closed_sessions =
                database.fail_running_capture_sessions("应用启动时关闭上一进程未完成的采集会话")?;
            if closed_sessions > 0 {
                eprintln!("closed {closed_sessions} stale running capture sessions on startup");
            }
            let collector = Collector::new(materialize_collector_assets(&app_data_dir)?);
            app.manage(AppState {
                database,
                collector,
            });
            app.manage(battle_grabber::new_state(app_data_dir.clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_workspace_summary,
            get_app_bundle,
            list_workspaces,
            create_workspace,
            get_collector_status,
            start_capture_session,
            stop_capture_session,
            save_member_binding,
            save_member_bindings,
            save_lineup_profile,
            upsert_lineup_stat,
            upsert_lineup_stats,
            upsert_lineup_matchup,
            upsert_lineup_matchups,
            get_comparison_stats,
            get_member_activity_alerts,
            get_cross_workspace_power_series,
            get_battle_reports_paged,
            get_alliance_logs_paged,
            get_member_snapshots,
            get_intel_snapshots,
            get_intel_entries,
            backup_data,
            restore_data,
            get_lineup_analysis,
            save_lineup_stat_notes,
            delete_lineup_stat,
            delete_capture_session,
            get_export_directory,
            set_export_directory,
            reset_export_directory,
            pick_export_directory,
            export_alliance_member_data_csv,
            export_bundle_json,
            export_bundle_csv,
            export_bundle_html,
            export_bundle_xlsx,
            export_lineup_library_json,
            export_lineup_library_csv,
            export_lineup_library_html,
            export_battle_report_json,
            export_battle_report_html,
            battle_grabber::get_bridge_path_cmd,
            battle_grabber::get_app_snapshot,
            battle_grabber::get_live_capture_snapshot,
            battle_grabber::get_alliance_records,
            battle_grabber::refresh_history,
            battle_grabber::list_scan_workspaces,
            battle_grabber::set_scan_workspace,
            battle_grabber::list_processes,
            battle_grabber::connect_process,
            battle_grabber::disconnect_process,
            battle_grabber::read_json_file,
            battle_grabber::read_text_file,
            battle_grabber::battle_grabber_write_text_export,
            battle_grabber::battle_grabber_open_path
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1);
        })
        .run(|_app_handle, event| {
            // P0-2：应用退出时回收 sidecar 子进程，避免孤儿 Python 进程与
            // frida 半写产物残留。
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = _app_handle.try_state::<AppState>() {
                    state.collector.shutdown();
                }
            }
        });
}

pub fn run_collector_sidecar() -> AppResult<()> {
    collector_sidecar::run()
}

fn materialize_collector_assets(app_data_dir: &std::path::Path) -> AppResult<PathBuf> {
    let script_path = app_data_dir.join("collector_sidecar.py");
    let manifest_path = app_data_dir.join("collector_manifest.json");
    let runtime_probe_path = app_data_dir.join("runtime_probe.py");
    let runtime_scan_path = app_data_dir.join("frida_nslg_runtime_scan.py");
    let flows_dir = app_data_dir.join("flows");
    write_text_if_changed(
        &script_path,
        include_str!("../../collector/collector_sidecar.py"),
    )?;
    write_text_if_changed(
        &manifest_path,
        include_str!("../../collector/collector_manifest.json"),
    )?;
    write_text_if_changed(
        &runtime_probe_path,
        include_str!("../../collector/runtime_probe.py"),
    )?;
    write_text_if_changed(
        &runtime_scan_path,
        include_str!("../../collector/frida_nslg_runtime_scan.py"),
    )?;
    write_text_if_changed(
        &flows_dir.join("__init__.py"),
        include_str!("../../collector/flows/__init__.py"),
    )?;
    write_text_if_changed(
        &flows_dir.join("base.py"),
        include_str!("../../collector/flows/base.py"),
    )?;
    write_text_if_changed(
        &flows_dir.join("registry.py"),
        include_str!("../../collector/flows/registry.py"),
    )?;
    write_text_if_changed(
        &flows_dir.join("alliance_data.py"),
        include_str!("../../collector/flows/alliance_data.py"),
    )?;
    write_text_if_changed(
        &flows_dir.join("battle_passive.py"),
        include_str!("../../collector/flows/battle_passive.py"),
    )?;
    Ok(script_path)
}

fn write_text_if_changed(path: &std::path::Path, contents: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let should_write = match fs::read_to_string(path) {
        Ok(existing) => existing != contents,
        Err(_) => true,
    };
    if should_write {
        fs::write(path, contents)?;
    }
    Ok(())
}

#[cfg(test)]
mod ipc_contract_tests {
    // ── 命令名单快照测试（S1-5）──
    // ts-rs 只覆盖类型体，不管命令注册名单；这里把 generate_handler! 注册的 52 个命令名
    // 与硬编码名单逐一比对，防止「前端 invoke 的命令没注册 / 注册了前端不知道的新命令」。
    // 维护规则：新增/删除/重命名 #[tauri::command] 时，同步更新 REGISTERED_COMMANDS，
    // 并保持与 generate_handler! 块内顺序一致（battle_grabber:: 前缀去掉后比对）。
    const REGISTERED_COMMANDS: [&str; 56] = [
        "get_workspace_summary",
        "get_app_bundle",
        "list_workspaces",
        "create_workspace",
        "get_collector_status",
        "start_capture_session",
        "stop_capture_session",
        "save_member_binding",
        "save_member_bindings",
        "save_lineup_profile",
        "upsert_lineup_stat",
        "upsert_lineup_stats",
        "upsert_lineup_matchup",
        "upsert_lineup_matchups",
        "get_comparison_stats",
        "get_member_activity_alerts",
        "get_cross_workspace_power_series",
        "get_battle_reports_paged",
        "get_alliance_logs_paged",
        "get_member_snapshots",
        "get_intel_snapshots",
        "get_intel_entries",
        "backup_data",
        "restore_data",
        "get_lineup_analysis",
        "save_lineup_stat_notes",
        "delete_lineup_stat",
        "delete_capture_session",
        "get_export_directory",
        "set_export_directory",
        "reset_export_directory",
        "pick_export_directory",
        "export_alliance_member_data_csv",
        "export_bundle_json",
        "export_bundle_csv",
        "export_bundle_html",
        "export_bundle_xlsx",
        "export_lineup_library_json",
        "export_lineup_library_csv",
        "export_lineup_library_html",
        "export_battle_report_json",
        "export_battle_report_html",
        "get_bridge_path_cmd",
        "get_app_snapshot",
        "get_live_capture_snapshot",
        "get_alliance_records",
        "refresh_history",
        "list_scan_workspaces",
        "set_scan_workspace",
        "list_processes",
        "connect_process",
        "disconnect_process",
        "read_json_file",
        "read_text_file",
        "battle_grabber_write_text_export",
        "battle_grabber_open_path",
    ];

    /// 从本文件源码中提取 generate_handler![ ... ] 块内的命令名（去掉 battle_grabber:: 前缀）。
    fn handler_registered_commands() -> Vec<String> {
        let source = include_str!("lib.rs");
        let start = source
            .find("generate_handler!")
            .expect("lib.rs 中应存在 generate_handler!");
        let bracket_start = source[start..]
            .find('[')
            .map(|i| start + i)
            .expect("generate_handler! 后应跟随 [");
        // 注册块内没有嵌套方括号，直接找下一个 ']'。
        let bracket_end = source[bracket_start..]
            .find(']')
            .map(|i| bracket_start + i)
            .expect("generate_handler! 块应以 ] 结束");
        source[bracket_start + 1..bracket_end]
            .split(',')
            .map(|entry| entry.trim())
            .filter(|entry| !entry.is_empty())
            .map(|entry| entry.rsplit("::").next().unwrap().to_string())
            .collect()
    }

    #[test]
    fn registered_command_list_matches_snapshot() {
        let actual = handler_registered_commands();
        assert_eq!(
            actual.len(),
            REGISTERED_COMMANDS.len(),
            "命令数量变化：actual={} expected={}；新增/删除命令时请同步更新 REGISTERED_COMMANDS",
            actual.len(),
            REGISTERED_COMMANDS.len()
        );
        for (index, (actual, expected)) in actual.iter().zip(REGISTERED_COMMANDS.iter()).enumerate() {
            assert_eq!(
                actual, expected,
                "第 {} 个命令不一致：actual={actual} expected={expected}；重命名/重排命令时请同步更新 REGISTERED_COMMANDS",
                index + 1
            );
        }
    }
}
