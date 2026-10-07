use crate::error::{AppError, AppResult};
use crate::models::{CollectorCaptureAck, CollectorFlowStatus, CollectorStatus};
use crate::proc_util::{hide_subprocess_window, kill_process_tree};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Per-line read budgets. The Python sidecar emits heartbeat `capture_log`
/// events every ~10s while a long probe runs, so the budget only bounds the
/// *silence* between two consecutive lines, not the total request duration.
/// Runtime probes (Frida attach) can legitimately stay quiet for over a
/// minute, hence the wider probe tier.
const LINE_READ_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_LINE_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) fn runtime_probe_enabled() -> bool {
    std::env::var("SMDC_RUNTIME_PROBE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on" | "jsonl" | "command" | "frida" | "runtime_scan"
            )
        })
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
pub struct Collector {
    inner: Arc<Mutex<CollectorRuntime>>,
    active_child_id: Arc<Mutex<Option<u32>>>,
    active: Arc<AtomicBool>,
}

#[derive(Debug)]
struct CollectorRuntime {
    script_path: PathBuf,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// Receives stdout lines from the dedicated reader thread. `None` when no
    /// sidecar process is attached.
    line_rx: Option<Receiver<String>>,
    /// 是否有请求正在锁外等待 sidecar 响应；等待期间 `line_rx` 被暂时取出，
    /// 其它调用者（如 status 轮询）不得再发起请求。
    request_in_flight: bool,
    active_child_id: Arc<Mutex<Option<u32>>>,
}

/// Spawn the long-lived stdout reader thread for a sidecar child. The thread
/// owns the stdout pipe, forwards each line into the channel, and exits on
/// EOF, read error, or when the receiver side is dropped (after `reset()`).
fn spawn_line_reader(stdout: ChildStdout) -> Receiver<String> {
    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = String::new();
        loop {
            buffer.clear();
            match reader.read_line(&mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    if tx.send(buffer.clone()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    rx
}

#[derive(Debug, Deserialize)]
struct SidecarEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    status: Option<String>,
    message: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarStatusPayload {
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    runtime_probe: Option<Value>,
    #[serde(default)]
    capture_flows: BTreeMap<String, CollectorFlowStatus>,
}

impl Collector {
    pub fn new(script_path: PathBuf) -> Self {
        let active_child_id = Arc::new(Mutex::new(None));
        let active = Arc::new(AtomicBool::new(false));
        Self {
            inner: Arc::new(Mutex::new(CollectorRuntime {
                script_path,
                child: None,
                stdin: None,
                line_rx: None,
                request_in_flight: false,
                active_child_id: active_child_id.clone(),
            })),
            active_child_id,
            active,
        }
    }

    pub fn status(&self) -> CollectorStatus {
        // 短锁探测：确认 runtime 空闲后**在同一把锁内占位**，再在锁外等待响应。
        // P0-4：此前只读 `request_in_flight` 判断就释放锁，若此窗口内 capture
        // 抢先取走 line_rx，status 会取到 None 并执行 reset()，把进行中的采集
        // 连同 sidecar 一起杀掉。占位后 capture 侧也会等待，不会再插队。
        let reserved = match self.inner.try_lock() {
            Some(mut runtime) => runtime.try_reserve_request(),
            None => false,
        };
        if !reserved {
            return CollectorStatus {
                available: true,
                mode: if runtime_probe_enabled() {
                    "runtime_probe".to_string()
                } else {
                    "preview".to_string()
                },
                capture_flows: BTreeMap::new(),
                runtime_probe: Some(json!({ "busy": true })),
                message: "collector sidecar 正在执行采集，状态会在后台完成后刷新".to_string(),
            };
        }

        match self.request_until_reserved(
            "status",
            Value::Object(Default::default()),
            &["status"],
            LINE_READ_TIMEOUT,
        ) {
            Ok(event) => {
                let parsed = event.payload.as_ref().and_then(|payload| {
                    serde_json::from_value::<SidecarStatusPayload>(payload.clone()).ok()
                });
                let mode = parsed
                    .as_ref()
                    .and_then(|payload| payload.mode.as_deref())
                    .unwrap_or("preview")
                    .to_string();
                let runtime_probe = parsed
                    .as_ref()
                    .and_then(|payload| payload.runtime_probe.clone());
                CollectorStatus {
                    available: event.status.as_deref() != Some("error"),
                    mode,
                    capture_flows: parsed
                        .map(|payload| payload.capture_flows)
                        .unwrap_or_default(),
                    runtime_probe,
                    message: match (event.message, event.status) {
                        (Some(message), Some(status)) => format!("{message} ({status})"),
                        (Some(message), None) => message,
                        (None, Some(status)) => format!("collector sidecar is {status}"),
                        (None, None) => "collector sidecar is ready".to_string(),
                    },
                }
            }
            Err(error) => CollectorStatus {
                available: false,
                mode: "preview".to_string(),
                capture_flows: BTreeMap::new(),
                runtime_probe: None,
                message: error.to_string(),
            },
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn is_busy(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    /// Atomically mark the collector busy. Returns `false` when a capture is
    /// already in flight, closing the check-then-act race that `is_busy`
    /// followed by `start_capture` used to have.
    pub fn try_acquire(&self) -> bool {
        self.active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn release(&self) {
        self.active.store(false, Ordering::SeqCst);
    }

    pub fn stop_capture(&self) -> AppResult<bool> {
        self.active.store(false, Ordering::SeqCst);
        let active_child_id = *self.active_child_id.lock();
        if let Some(child_id) = active_child_id {
            kill_process_tree(child_id);
            *self.active_child_id.lock() = None;
            // P0-3：改为阻塞式持锁执行完整 stop + reset，与 ensure_running /
            // request_until 的持锁窗口互斥，消除"停止时恰好并发 spawn 新进程"
            // 导致的 sidecar 残留竞态。
            let mut runtime = self.inner.lock();
            runtime.reset();
            return Ok(true);
        }
        // 无已注册 child_id 时同样阻塞持锁，确保与并发 spawn 窗口互斥；
        // stop_process 幂等（无子进程时返回 false 表示"当前没有正在运行的采集"）。
        let mut runtime = self.inner.lock();
        Ok(runtime.stop_process())
    }

    /// Shut the collector down completely (used on app exit).
    pub fn shutdown(&self) {
        self.active.store(false, Ordering::SeqCst);
        let active_child_id = *self.active_child_id.lock();
        if let Some(child_id) = active_child_id {
            kill_process_tree(child_id);
            *self.active_child_id.lock() = None;
        }
        self.inner.lock().reset();
    }

    /// Run a capture request against the sidecar. The busy flag is owned by
    /// the caller (`try_acquire`/`release`); this method only performs I/O.
    pub fn start_capture(&self, capture_type: &str) -> AppResult<CollectorCaptureAck> {
        let payload = serde_json::json!({
            "captureType": capture_type,
        });
        let event = self.request_until("start_capture", payload, &["capture_result"], PROBE_LINE_TIMEOUT)?;
        Ok(CollectorCaptureAck {
            status: event.status,
            session_id: event.session_id,
            message: event
                .message
                .unwrap_or_else(|| "collector accepted capture request".to_string()),
            payload: event.payload,
        })
    }

    fn request_until(
        &self,
        command: &str,
        payload: Value,
        terminal_kinds: &[&str],
        line_timeout: Duration,
    ) -> AppResult<SidecarEvent> {
        // 先占位（最多等 2s 让 status 轮询让出），再进入真正的请求流程。
        // 占位保证同一时刻只有一个请求持有 line_rx，避免互相 take 到 None 后
        // 触发 reset() 把对方的采集杀掉（P0-4）。
        self.reserve_request(Duration::from_secs(2))?;
        self.request_until_reserved(command, payload, terminal_kinds, line_timeout)
    }

    /// 在锁内尝试占位一次请求；已有请求在飞行中则按 `wait` 轮询等待。
    fn reserve_request(&self, wait: Duration) -> AppResult<()> {
        let deadline = std::time::Instant::now() + wait;
        loop {
            // 用显式作用域保证锁不会跨 sleep 持有。
            {
                let mut runtime = self.inner.lock();
                if runtime.try_reserve_request() {
                    return Ok(());
                }
            }
            if std::time::Instant::now() >= deadline {
                return Err(AppError::Message(
                    "collector sidecar 正在处理其它请求，请稍后重试".to_string(),
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// 执行一次已占位的请求：Phase 1 写命令并取出 reader channel，
    /// Phase 2 在锁外等待响应，Phase 3 归还 channel 并清除占位。
    fn request_until_reserved(
        &self,
        command: &str,
        payload: Value,
        terminal_kinds: &[&str],
        line_timeout: Duration,
    ) -> AppResult<SidecarEvent> {
        // Phase 1（持锁）：确保 sidecar 在运行、写入命令、暂时取出 reader
        // channel。锁只覆盖到 stdin 写完的瞬间，不覆盖响应等待。
        let (request_id, line_rx) = {
            let mut runtime = self.inner.lock();
            let request_id = match runtime.send_request(command, payload) {
                Ok(request_id) => request_id,
                Err(error) => {
                    // 释放占位，否则会永久停在 busy 状态。
                    runtime.request_in_flight = false;
                    return Err(error);
                }
            };
            let line_rx = match runtime.line_rx.take() {
                Some(line_rx) => line_rx,
                None => {
                    runtime.request_in_flight = false;
                    runtime.reset();
                    return Err(AppError::Message("collector stdout unavailable".to_string()));
                }
            };
            (request_id, line_rx)
        };

        // Phase 2（锁外）：基于 channel 等待终结事件，心跳/日志行会不断
        // 刷新逐行超时，不会冻结其它需要 runtime 锁的调用者。
        let result = await_sidecar_event(&line_rx, &request_id, terminal_kinds, line_timeout);

        // Phase 3（持锁）：归还 channel（若 sidecar 在等待期间被
        // stop/reset 掉则丢弃旧 channel），并清除 in-flight 标记。
        {
            let mut runtime = self.inner.lock();
            runtime.request_in_flight = false;
            if runtime.stdin.is_some() && runtime.line_rx.is_none() {
                runtime.line_rx = Some(line_rx);
            } else {
                drop(line_rx);
            }
            if result.is_err() {
                // 超时/断连时重置 runtime：杀掉进程树，下次请求重新拉起；
                // reader 线程会随管道关闭自行退出。
                runtime.reset();
            }
        }

        result
    }
}

/// 在 reader channel 上等待指定 request_id 的终结事件。逐行超时由
/// `line_timeout` 控制（sidecar 长任务期间有心跳行持续刷新）。
fn await_sidecar_event(
    line_rx: &Receiver<String>,
    request_id: &str,
    terminal_kinds: &[&str],
    line_timeout: Duration,
) -> AppResult<SidecarEvent> {
    loop {
        let line = match line_rx.recv_timeout(line_timeout) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => {
                return Err(AppError::Message(
                    "collector sidecar read timed out".to_string(),
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AppError::Message(
                    "collector sidecar closed its stdout stream".to_string(),
                ));
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed = match serde_json::from_str::<SidecarEvent>(trimmed) {
            Ok(event) => event,
            Err(_) => continue,
        };

        if parsed.kind == "hello" {
            continue;
        }

        if parsed.kind == "error"
            && (parsed.request_id.as_deref() == Some(request_id) || parsed.request_id.is_none())
        {
            return Err(AppError::Message(parsed.message.unwrap_or_else(|| {
                "collector sidecar reported an error".to_string()
            })));
        }

        if parsed.request_id.as_deref() == Some(request_id)
            && terminal_kinds.contains(&parsed.kind.as_str())
        {
            return Ok(parsed);
        }
    }
}

impl CollectorRuntime {
    /// 确保 sidecar 在运行并向其 stdin 写入一条命令，返回请求 id。
    /// 只覆盖写命令的瞬间，响应等待由调用者在锁外完成。
    fn send_request(&mut self, command: &str, payload: Value) -> AppResult<String> {
        self.ensure_running()?;
        let request_id = format!(
            "req-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| AppError::Message(error.to_string()))?
                .as_millis(),
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let request = serde_json::json!({
            "requestId": request_id,
            "command": command,
            "payload": payload,
        });

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(request.to_string().as_bytes())?;
            stdin.write_all(b"\n")?;
            stdin.flush()?;
        } else {
            return Err(AppError::Message("collector stdin unavailable".to_string()));
        }

        if self.line_rx.is_none() {
            return Err(AppError::Message("collector stdout unavailable".to_string()));
        }

        Ok(request_id)
    }

    fn ensure_running(&mut self) -> AppResult<()> {
        if let Some(child) = self.child.as_mut() {
            if child.try_wait()?.is_some() {
                self.reset();
            } else if self.stdin.is_some() && self.line_rx.is_some() {
                return Ok(());
            }
        }

        self.spawn_process()
    }

    fn spawn_process(&mut self) -> AppResult<()> {
        let mut last_error: Option<std::io::Error> = None;

        if std::env::var_os("SMDC_COLLECTOR_NATIVE_SIDECAR").is_some() && !runtime_probe_enabled() {
            match self.spawn_native_sidecar() {
                Ok(()) => return Ok(()),
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }

        let candidates = [("python", Vec::<&str>::new()), ("py", vec!["-3"])];
        for (program, prefix) in candidates {
            let mut command = Command::new(program);
            command.args(prefix.iter().copied());
            command.arg(&self.script_path);
            command.stdin(Stdio::piped());
            command.stdout(Stdio::piped());
            let stderr_path = self
                .script_path
                .parent()
                .map(|parent| parent.join("collector_sidecar.err.log"));
            if let Some(path) = stderr_path {
                let stderr = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)?;
                command.stderr(Stdio::from(stderr));
            } else {
                command.stderr(Stdio::null());
            }
            hide_subprocess_window(&mut command);

            match command.spawn() {
                Ok(child) => {
                    self.attach_child_io(child)?;
                    return Ok(());
                }
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }

        Err(AppError::Message(format!(
            "failed to launch collector sidecar: {}",
            last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "unknown launcher error".to_string())
        )))
    }

    /// Take over a spawned child's pipes, start the stdout reader thread, and
    /// register the child as the active sidecar process.
    fn attach_child_io(&mut self, mut child: Child) -> AppResult<()> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Message("collector stdin missing".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Message("collector stdout missing".to_string()))?;
        self.stdin = Some(stdin);
        self.line_rx = Some(spawn_line_reader(stdout));
        *self.active_child_id.lock() = Some(child.id());
        self.child = Some(child);
        Ok(())
    }

    fn spawn_native_sidecar(&mut self) -> std::io::Result<()> {
        let exe_path = std::env::current_exe()?;
        let mut command = Command::new(exe_path);
        command.arg("--collector-sidecar");
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::null());
        hide_subprocess_window(&mut command);

        let child = command.spawn()?;
        self.attach_child_io(child)
            .map_err(|error| std::io::Error::other(error.to_string()))
    }

    /// 在同一把锁内完成「检查空闲 + 占位」，返回 false 表示已有请求在飞行中。
    /// 供 `status`（try_lock 快路径）与 `reserve_request`（阻塞路径）共用，
    /// 消除"锁外判断 → 锁外 take"之间的竞争窗口。
    fn try_reserve_request(&mut self) -> bool {
        if self.request_in_flight {
            return false;
        }
        self.request_in_flight = true;
        true
    }

    fn reset(&mut self) {
        if let Some(mut child) = self.child.take() {
            // P0-1：sidecar 会派生 frida 扫描子进程（runtime_probe 里的
            // Popen），只 kill 父进程会把扫描进程留成孤儿——而 reset() 恰好
            // 在"探针超时/卡住"这一最需要彻底清理的时刻被调用，每次重试都会
            // 再叠加一个。这里改为先按进程树整体回收。
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
        // Dropping the receiver lets the reader thread exit on its next line
        // (or immediately once the killed child's pipe closes).
        self.line_rx = None;
        // reset 之后没有任何请求可以被满足，占位必须一并清除。
        self.request_in_flight = false;
        *self.active_child_id.lock() = None;
    }

    fn stop_process(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            self.stdin = None;
            self.line_rx = None;
            self.request_in_flight = false;
            *self.active_child_id.lock() = None;
            return false;
        };
        let child_id = child.id();
        kill_process_tree(child_id);
        let _ = child.kill();
        let _ = child.wait();
        self.child = None;
        self.stdin = None;
        self.line_rx = None;
        self.request_in_flight = false;
        *self.active_child_id.lock() = None;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::Collector;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        keys: Vec<&'static str>,
    }

    impl EnvGuard {
        fn new(keys: Vec<&'static str>) -> Self {
            for key in &keys {
                std::env::remove_var(key);
            }
            Self { keys }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for key in &self.keys {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn try_acquire_is_atomic_and_release_restores_availability() {
        let collector = Collector::new(PathBuf::from("unused-sidecar.py"));
        assert!(!collector.is_busy());
        assert!(collector.try_acquire());
        assert!(collector.is_busy());
        assert!(!collector.try_acquire(), "second acquire must fail");
        collector.release();
        assert!(!collector.is_busy());
        assert!(collector.try_acquire());
        collector.release();
        assert!(!collector.is_busy());
    }

    #[test]
    fn collector_can_talk_to_sidecar_preview() {
        let _env_lock = TEST_ENV_LOCK.lock().expect("test env lock");
        let _env_guard = EnvGuard::new(vec![
            "SMDC_COLLECTOR_NATIVE_SIDECAR",
            "SMDC_RUNTIME_PROBE",
            "SMDC_RUNTIME_PROBE_JSONL",
            "SMDC_RUNTIME_SCAN_COMMAND",
            "SMDC_RUNTIME_SCAN_PROCESS",
            "SMDC_RUNTIME_SCAN_SCRIPT",
            "SMDC_RUNTIME_SCAN_CWD",
            "SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL",
            "SMDC_ALLOW_EXTERNAL_RUNTIME_SCAN",
        ]);
        let script_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("collector")
            .join("collector_sidecar.py");
        let collector = Collector::new(script_path);

        let status = collector.status();
        assert!(status.available);
        assert!(status.message.contains("ready") || status.message.contains("preview"));
        let alliance_flow = status
            .capture_flows
            .get("alliance_data")
            .expect("alliance flow entry");
        assert_eq!(alliance_flow.flow, "alliance_runtime");
        assert_eq!(
            alliance_flow.expected_artifacts,
            vec!["rpc_dump", "ui_snapshot", "static_config"]
        );
        assert!(alliance_flow
            .navigation
            .contains(&"member_list".to_string()));
        assert_eq!(alliance_flow.next_probe.as_deref(), Some("__noop__"));

        let battle_flow = status
            .capture_flows
            .get("battle_passive")
            .expect("battle flow entry");
        assert_eq!(battle_flow.flow, "battle_listener");
        assert_eq!(
            battle_flow.expected_artifacts,
            vec!["battle_block_list", "battle_detail", "battle_environment"]
        );
        assert!(battle_flow
            .navigation
            .contains(&"battle_report_list".to_string()));
        assert_eq!(
            battle_flow.next_probe.as_deref(),
            Some("__install_battle_listener_hooks__")
        );

        let ack = collector
            .start_capture("alliance_data")
            .expect("start capture through sidecar");
        assert_eq!(ack.status.as_deref(), Some("completed"));
        assert!(ack
            .session_id
            .as_deref()
            .is_some_and(|id| id.starts_with("preview-")));
        assert_eq!(ack.message, "preview capture completed for alliance_data");

        let capture_result = ack.capture_result().expect("typed capture result");
        assert_eq!(capture_result.collector_mode, "preview");
        assert_eq!(capture_result.capture_type, "alliance_data");
        assert_eq!(capture_result.collector_payload.flow, "alliance_runtime");
        assert_eq!(
            capture_result.collector_payload.expected_artifacts,
            vec!["rpc_dump", "ui_snapshot", "static_config"]
        );
        assert!(capture_result
            .collector_payload
            .navigation
            .contains(&"member_list".to_string()));

        let battle_ack = collector
            .start_capture("battle_passive")
            .expect("start battle passive capture through sidecar");
        let battle_capture_result = battle_ack
            .capture_result()
            .expect("battle typed capture result");
        assert_eq!(battle_ack.status.as_deref(), Some("completed"));
        assert_eq!(battle_capture_result.collector_mode, "preview");
        assert_eq!(battle_capture_result.capture_type, "battle_passive");
        assert_eq!(
            battle_capture_result.collector_payload.flow,
            "battle_listener"
        );
        assert!(battle_capture_result
            .collector_payload
            .expected_artifacts
            .contains(&"battle_detail".to_string()));
        assert!(battle_capture_result
            .collector_payload
            .navigation
            .contains(&"battle_report_list".to_string()));

        collector.shutdown();
    }

    #[test]
    fn runtime_probe_prefers_python_sidecar_adapter() {
        let _env_lock = TEST_ENV_LOCK.lock().expect("test env lock");
        let _env_guard = EnvGuard::new(vec![
            "SMDC_COLLECTOR_NATIVE_SIDECAR",
            "SMDC_RUNTIME_PROBE",
            "SMDC_RUNTIME_PROBE_JSONL",
            "SMDC_RUNTIME_SCAN_COMMAND",
            "SMDC_RUNTIME_SCAN_PROCESS",
            "SMDC_RUNTIME_SCAN_SCRIPT",
            "SMDC_RUNTIME_SCAN_CWD",
            "SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL",
            "SMDC_ALLOW_EXTERNAL_RUNTIME_SCAN",
        ]);
        let script_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("collector")
            .join("collector_sidecar.py");
        let replay_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("test-data")
            .join("runtime-alliance-rpc.jsonl");

        std::env::set_var("SMDC_COLLECTOR_NATIVE_SIDECAR", "1");
        std::env::set_var("SMDC_RUNTIME_PROBE", "1");
        std::env::set_var("SMDC_RUNTIME_PROBE_JSONL", replay_path);

        let collector = Collector::new(script_path);
        let status = collector.status();
        assert!(status.available);
        assert_eq!(status.mode, "runtime_probe");

        let ack = collector
            .start_capture("alliance_data")
            .expect("start runtime probe capture through python sidecar");
        let capture_result = ack.capture_result().expect("typed capture result");
        assert_eq!(ack.status.as_deref(), Some("completed"));
        assert!(ack
            .session_id
            .as_deref()
            .is_some_and(|id| id.starts_with("runtime-")));
        assert_eq!(capture_result.collector_mode, "runtime_probe");
        assert_eq!(
            capture_result
                .collector_payload
                .runtime
                .as_ref()
                .and_then(|value| value.get("mode")),
            Some(&serde_json::Value::String("jsonl_replay".to_string()))
        );
        assert!(capture_result.collector_payload.evidence.is_some());

        collector.shutdown();
    }
}
