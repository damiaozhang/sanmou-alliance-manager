#!/usr/bin/env python3
"""JSON line sidecar preview for the collector.

The stdin command loop and long-running runtime probes are decoupled: a
background reader thread feeds raw stdin lines into a queue, and the command
loop dispatches them with a timeout. A start_capture request emits
capture_started immediately and finishes the probe on a worker thread, so the
command loop stays responsive to status / stop / repeated start_capture while
a probe runs.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from flows.registry import get_flow_handler, load_flow_catalog
import runtime_probe
from runtime_probe import RuntimeProbeError, probe_status, runtime_probe_enabled, start_probe

SCRIPT_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = SCRIPT_DIR / "collector_manifest.json"
MANIFEST_VERSION = "2026-06-09"
SIDECAR_VERSION = "1.0.4"

# Command-loop poll cadence while the stdin queue is empty. Only affects EOF
# detection latency; pending commands are dispatched as soon as the reader
# thread enqueues them.
_STDIN_POLL_SECONDS = 0.05

# stdout 写锁：命令循环线程与 probe worker 线程都会调用 emit，
# 加锁避免两线程的 JSON 行在缓冲区交错损坏。
_EMIT_LOCK = threading.Lock()


@dataclass
class SidecarEvent:
    type: str
    requestId: str | None = None
    sessionId: str | None = None
    status: str | None = None
    message: str | None = None
    payload: dict[str, Any] | None = None


def emit(event: SidecarEvent) -> None:
    with _EMIT_LOCK:
        sys.stdout.write(json.dumps(asdict(event), ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def load_manifest() -> dict[str, Any]:
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[sidecar] manifest load failed: {e}", file=sys.stderr)
        return {}


MANIFEST = load_manifest()


def capture_flow_catalog() -> dict[str, Any]:
    return load_flow_catalog(MANIFEST)


def capture_flow_handler(capture_type: str):
    return get_flow_handler(MANIFEST, capture_type)


def handle_status(request_id: str | None) -> None:
    emit(
        SidecarEvent(
            type="status",
            requestId=request_id,
            status="ready",
            message="collector sidecar preview is ready",
            payload={
                "mode": "runtime_probe" if runtime_probe_enabled() else "preview",
                "supports": ["status", "start_capture", "stop"],
                "ocr": False,
                "pdf": False,
                "sidecarVersion": SIDECAR_VERSION,
                "manifestVersion": MANIFEST.get("manifestVersion", MANIFEST_VERSION),
                "manifestSource": str(MANIFEST_PATH),
                "runtimeProbe": probe_status(),
                "captureFlows": capture_flow_catalog(),
            },
        )
    )


def resolve_capture_type(requested_capture_type: str) -> str:
    capture_type = requested_capture_type.strip() or "alliance_data"
    capture_flow_handler(capture_type)
    return capture_type


def build_runtime_failure_payload(handler, runtime_error: str) -> dict[str, Any]:
    runtime_status = probe_status()
    capture_payload = handler.build_capture_payload()
    capture_payload["collectorMode"] = "runtime_probe"
    capture_payload["runtime"] = {
        "mode": runtime_status.get("mode", "runtime_probe"),
        "status": "failed",
        "error": runtime_error,
        "preflight": runtime_status,
    }
    return capture_payload


def _probe_heartbeat_interval_seconds() -> float:
    """Heartbeat cadence while a long runtime probe runs.

    Overridable via SMDC_PROBE_HEARTBEAT_SECONDS so tests can use short
    intervals; defaults to ~10s, comfortably below the host's 180s per-line
    read timeout.
    """
    try:
        value = float(os.environ.get("SMDC_PROBE_HEARTBEAT_SECONDS", "10"))
    except ValueError:
        return 10.0
    return value if value > 0 else 10.0


def _run_probe_with_heartbeats(
    request_id: str | None,
    session_id: str,
    capture_type: str,
    handler,
) -> dict[str, Any]:
    """Run the (potentially minutes-long) runtime probe on a worker thread
    while emitting periodic capture_log heartbeat events on the main thread
    so the Rust host never sees a silent stdout long enough to time out.
    """
    outcome: dict[str, Any] = {}

    def _worker() -> None:
        try:
            probe_result = start_probe(capture_type, handler.definition)
            outcome["payload"] = handler.module.build_runtime_capture_payload(
                handler.definition,
                capture_type,
                probe_result,
            )
        except RuntimeProbeError as exc:
            outcome["runtime_error"] = str(exc)
        except Exception as exc:  # Propagated after the worker joins.
            outcome["unexpected_error"] = exc

    worker = threading.Thread(target=_worker, daemon=True)
    worker.start()
    heartbeat_interval = _probe_heartbeat_interval_seconds()
    while True:
        worker.join(timeout=heartbeat_interval)
        if not worker.is_alive():
            break
        emit(
            SidecarEvent(
                type="capture_log",
                requestId=request_id,
                sessionId=session_id,
                status="info",
                message="runtime probe 仍在执行…",
                payload={"heartbeat": True, "captureType": capture_type},
            )
        )

    if "unexpected_error" in outcome:
        raise outcome["unexpected_error"]
    return outcome


class _CaptureState:
    """Shared state between the stdin command loop and capture workers."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False


_CAPTURE_STATE = _CaptureState()


def _capture_running() -> bool:
    with _CAPTURE_STATE.lock:
        return _CAPTURE_STATE.running


def _run_capture_phase(
    request_id: str | None,
    session_id: str,
    capture_type: str,
    handler,
) -> None:
    """Background half of a start_capture request.

    Runs on a worker thread so the stdin command loop stays responsive while
    the (potentially minutes-long) runtime probe executes. Emits the same
    capture_log / capture_result / error events as the old synchronous path.
    """
    try:
        runtime_error: str | None = None
        if runtime_probe_enabled() and hasattr(handler.module, "build_runtime_capture_payload"):
            outcome = _run_probe_with_heartbeats(request_id, session_id, capture_type, handler)
            if "runtime_error" in outcome:
                runtime_error = outcome["runtime_error"]
                capture_payload = build_runtime_failure_payload(handler, runtime_error)
            else:
                capture_payload = outcome.get("payload") or handler.build_capture_payload()
        else:
            capture_payload = handler.build_capture_payload()

        collector_mode = str(capture_payload.get("collectorMode", "preview"))
        capture_log = handler.build_capture_log(capture_payload, session_id)
        if runtime_error:
            capture_log = {"runtimeProbe": "failed", "error": runtime_error, "nextProbe": capture_payload.get("nextProbe")}
        emit(
            SidecarEvent(
                type="capture_log",
                requestId=request_id,
                sessionId=session_id,
                status="error" if runtime_error else "info",
                message=runtime_error or handler.capture_log_message(),
                payload=capture_log,
            )
        )
        emit(
            SidecarEvent(
                type="capture_result",
                requestId=request_id,
                sessionId=session_id,
                status="completed" if not runtime_error else "failed",
                message=(
                    f"{collector_mode} capture completed for {capture_type}"
                    if not runtime_error
                    else f"runtime probe failed for {capture_type}: {runtime_error}"
                ),
                payload=handler.build_capture_result(capture_payload, session_id),
            )
        )
    except Exception as exc:  # Keep the same error contract as the command loop.
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit(SidecarEvent(type="error", requestId=request_id, status="error", message=str(exc)))
    finally:
        with _CAPTURE_STATE.lock:
            _CAPTURE_STATE.running = False


def handle_start_capture(request_id: str | None, payload: dict[str, Any]) -> None:
    # P0-1 修复：新采集开始，重置扫描中止信号。
    runtime_probe.clear_scan_abort()
    capture_type = resolve_capture_type(str(payload.get("captureType", "alliance_data")))
    handler = capture_flow_handler(capture_type)
    session_id = (
        f"runtime-{uuid.uuid4()}"
        if runtime_probe_enabled() and hasattr(handler.module, "build_runtime_capture_payload")
        else f"preview-{uuid.uuid4()}"
    )
    started_payload = handler.build_capture_payload()
    if runtime_probe_enabled():
        started_payload["collectorMode"] = "runtime_probe"
        started_payload["runtime"] = {
            "mode": probe_status().get("mode", "runtime_probe"),
            "status": "running",
            "preflight": probe_status(),
        }
    with _CAPTURE_STATE.lock:
        _CAPTURE_STATE.running = True
    emit(
        SidecarEvent(
            type="capture_started",
            requestId=request_id,
            sessionId=session_id,
            status="running",
            message=f"{started_payload.get('collectorMode', 'preview')} capture started for {capture_type}",
            payload=started_payload,
        )
    )
    # Finish the probe off the command loop; the loop keeps dispatching
    # status / stop / start_capture while the probe runs.
    threading.Thread(
        target=_run_capture_phase,
        args=(request_id, session_id, capture_type, handler),
        daemon=True,
    ).start()


def _stdin_reader(stdin, line_queue: queue.Queue[str | None]) -> None:
    """Background stdin reader: enqueue raw lines; a ``None`` sentinel marks EOF."""
    for line in stdin:
        line_queue.put(line)
    line_queue.put(None)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    emit(SidecarEvent(
        type="hello",
        status="ready",
        message="collector sidecar online",
        payload={"sidecarVersion": SIDECAR_VERSION, "manifestVersion": MANIFEST.get("manifestVersion", MANIFEST_VERSION)}
    ))

    line_queue: queue.Queue[str | None] = queue.Queue()
    reader = threading.Thread(
        target=_stdin_reader, args=(sys.stdin, line_queue), daemon=True
    )
    reader.start()

    # A fresh process owns this state; reset so repeated main() calls (e.g. in
    # tests) never inherit a stale "capture running" flag.
    with _CAPTURE_STATE.lock:
        _CAPTURE_STATE.running = False
    # P0-1 修复：每次启动重置扫描中止信号（扫描子进程中止态由 runtime_probe 维护）。
    runtime_probe.clear_scan_abort()

    while True:
        try:
            line = line_queue.get(timeout=_STDIN_POLL_SECONDS)
        except queue.Empty:
            continue
        if line is None:  # stdin hit EOF; nothing more can arrive.
            # P0-1 修复：sidecar 即将退出，回收可能仍在运行的 frida 扫描子进程
            # （daemon worker 会被强杀，但扫描脚本是独立 OS 进程，须按 pid 显式
            # 强杀，否则成为孤儿进程继续占用游戏/资源）。
            runtime_probe.set_scan_abort()
            runtime_probe.kill_scan_process_tree()
            return 0
        line = line.strip()
        if not line:
            continue
        request_id: str | None = None
        try:
            message = json.loads(line)
            request_id = message.get("requestId")
            command = message.get("command")
            payload = message.get("payload") or {}
            if command == "status":
                handle_status(request_id)
            elif command == "start_capture":
                if _capture_running():
                    emit(
                        SidecarEvent(
                            type="error",
                            requestId=request_id,
                            status="error",
                            message="capture already running",
                        )
                    )
                else:
                    handle_start_capture(request_id, payload)
            elif command == "stop":
                emit(
                    SidecarEvent(
                        type="stopped",
                        requestId=request_id,
                        status="ok",
                        message="collector stopped",
                    )
                )
                # P0-1 修复：通知并回收可能仍在运行的 frida 扫描子进程。sidecar 立即
                # 退出会强杀 daemon worker 线程，但扫描脚本是独立 OS 进程，须按 pid
                # 显式强杀（kill_scan_process_tree 只杀扫描脚本进程树，绝不碰游戏
                # 进程），否则会成为孤儿进程。
                runtime_probe.set_scan_abort()
                runtime_probe.kill_scan_process_tree()
                return 0
            else:
                emit(
                    SidecarEvent(
                        type="error",
                        requestId=request_id,
                        status="error",
                        message=f"unknown command: {command}",
                    )
                )
        except json.JSONDecodeError as exc:
            # JSON 解析错误：提供行号位置和修复建议
            emit(
                SidecarEvent(
                    type="error",
                    requestId=request_id,
                    status="error",
                    message=f"JSON 解析失败 (位置 {exc.pos}): {exc.msg}",
                    payload={"hint": "请确保发送的是合法的 JSON 对象", "line": line[:200]},
                )
            )
        except Exception as exc:  # Keep the sidecar alive for protocol errors.
            import traceback
            traceback.print_exc(file=sys.stderr)
            # 提供异常类型和堆栈摘要，便于定位问题
            error_type = type(exc).__name__
            emit(
                SidecarEvent(
                    type="error",
                    requestId=request_id,
                    status="error",
                    message=f"{error_type}: {exc}",
                    payload={"errorType": error_type, "sidecarVersion": SIDECAR_VERSION},
                )
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
