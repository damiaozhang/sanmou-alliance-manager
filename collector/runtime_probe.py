from __future__ import annotations

import hashlib
import csv
import json
import os
import shlex
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class RuntimeProbeError(RuntimeError):
    pass


class RuntimeScanTimeoutError(RuntimeProbeError):
    """The scan subprocess was killed after exceeding its timeout.

    Almost always means the frida attach/script injection hung inside the
    target game process (e.g. a wedged agent from a previously killed scan).
    Retrying against the same process is futile and only prolongs the hang,
    so callers should fail fast and advise restarting the game.
    """


@dataclass(frozen=True)
class RuntimeProbeResult:
    capture_type: str
    mode: str
    artifact_type: str
    source: str
    captured_at: str
    records: list[dict[str, Any]]
    sha256: str

    def evidence(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "artifacts": [
                {
                    "artifactType": self.artifact_type,
                    "source": self.source,
                    "capturedAt": self.captured_at,
                    "sha256": self.sha256,
                    "recordCount": len(self.records),
                    "records": self.records,
                }
            ],
        }


def _runtime_probe_env_value() -> str:
    return os.environ.get("SMDC_RUNTIME_PROBE", "").strip().lower()


def runtime_probe_enabled() -> bool:
    return _runtime_probe_env_value() in {
        "1",
        "true",
        "yes",
        "on",
        "jsonl",
        "command",
        "frida",
        "runtime_scan",
    }


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _external_runtime_scan_overrides_enabled() -> bool:
    return _truthy_env("SMDC_RUNTIME_SCAN_ALLOW_EXTERNAL") or _truthy_env(
        "SMDC_ALLOW_EXTERNAL_RUNTIME_SCAN"
    )


def _subprocess_no_window_kwargs() -> dict[str, Any]:
    if os.name != "nt":
        return {}
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return {"creationflags": creation_flags} if creation_flags else {}


def _kill_process_tree(pid: int) -> None:
    """P2-5 修复：subprocess.run 超时只杀直接子进程，frida 派生进程/Windows
    shell 包装层会残留。这里显式按进程树强杀（Windows 用 taskkill /T /F，
    其它平台回退 os.killpg）。"""
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=10,
                **_subprocess_no_window_kwargs(),
            )
        except Exception:  # noqa: BLE001 - 清理失败不应影响主流程
            pass
    else:
        try:
            os.killpg(os.getpgid(pid), 9)
        except Exception:  # noqa: BLE001
            pass


# --- P0-1: 扫描子进程生命周期跟踪 + 中止信号 ---
# sidecar 收到 stop/EOF 后会立即退出（return 0），daemon worker 线程被强杀；
# 但 frida 扫描脚本是独立 OS 进程，父进程退出后会成为孤儿继续运行（Windows 下
# 尤甚，可能继续占用游戏进程/资源）。这里集中维护"当前正在运行的扫描子进程 pid"
# 与一个中止事件，供 collector_sidecar 在 stop/EOF 时按 pid 显式强杀回收，也供
# worker 在收到中止后主动终止扫描，避免孤儿进程。
_scan_proc_lock = threading.Lock()
_scan_proc_pid: int | None = None
_scan_abort_event = threading.Event()


def _register_scan_proc(pid: int) -> None:
    with _scan_proc_lock:
        global _scan_proc_pid
        _scan_proc_pid = pid


def _unregister_scan_proc() -> None:
    with _scan_proc_lock:
        global _scan_proc_pid
        _scan_proc_pid = None


def get_scan_proc_pid() -> int | None:
    with _scan_proc_lock:
        return _scan_proc_pid


def kill_scan_process_tree() -> None:
    """按 pid 强杀当前扫描子进程及其派生树（绝不碰游戏进程）。
    供 collector_sidecar 在 stop/EOF 退出前调用，确保孤儿进程被回收。"""
    pid = get_scan_proc_pid()
    if pid is None:
        return
    try:
        _kill_process_tree(pid)
    except Exception:  # noqa: BLE001 - 清理失败不影响主流程
        pass
    finally:
        _unregister_scan_proc()


def set_scan_abort() -> None:
    """通知正在运行的扫描应尽快终止（由 sidecar 的 stop/EOF 分支调用）。"""
    _scan_abort_event.set()


def clear_scan_abort() -> None:
    _scan_abort_event.clear()


def scan_aborted() -> bool:
    return _scan_abort_event.is_set()


def probe_status() -> dict[str, Any]:
    mode = _probe_mode()
    if mode == "runtime_scan":
        return _runtime_scan_status()
    return {
        "enabled": runtime_probe_enabled(),
        "mode": mode,
        "source": os.environ.get("SMDC_RUNTIME_PROBE_JSONL", "")
        if mode == "jsonl_replay"
        else os.environ.get("SMDC_RUNTIME_SCAN_OUT", ""),
        "ready": bool(os.environ.get("SMDC_RUNTIME_PROBE_JSONL", "").strip()),
        "issues": []
        if os.environ.get("SMDC_RUNTIME_PROBE_JSONL", "").strip()
        else ["SMDC_RUNTIME_PROBE_JSONL is not set"],
    }


def start_probe(capture_type: str, definition: dict[str, Any]) -> RuntimeProbeResult:
    mode = _probe_mode()
    if mode == "runtime_scan":
        return _start_runtime_scan(capture_type, definition)
    return _start_jsonl_replay(capture_type, definition)


def _probe_mode() -> str:
    value = _runtime_probe_env_value()
    if value and not runtime_probe_enabled():
        raise RuntimeProbeError(f"SMDC_RUNTIME_PROBE is not enabled: {value}")
    if value in {"command", "frida", "runtime_scan"}:
        return "runtime_scan"
    return "jsonl_replay"


def _start_jsonl_replay(capture_type: str, definition: dict[str, Any]) -> RuntimeProbeResult:
    source = os.environ.get("SMDC_RUNTIME_PROBE_JSONL", "").strip()
    if not source:
        raise RuntimeProbeError("SMDC_RUNTIME_PROBE_JSONL is not set")

    path = Path(source)
    if not path.is_file():
        raise RuntimeProbeError(f"runtime probe jsonl not found: {source}")

    records = _read_jsonl(path)
    if not records:
        raise RuntimeProbeError(f"runtime probe jsonl is empty: {source}")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    artifact_type = _artifact_type(definition)
    captured_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())
    return RuntimeProbeResult(
        capture_type=capture_type,
        mode="jsonl_replay",
        artifact_type=artifact_type,
        source=str(path),
        captured_at=captured_at,
        records=records,
        sha256=digest,
    )


def _start_runtime_scan(capture_type: str, definition: dict[str, Any]) -> RuntimeProbeResult:
    status = _runtime_scan_status()
    process = str(status.get("processTarget") or "").strip()
    if not process:
        raise RuntimeProbeError("runtime scan process is not configured and no NSLG process was found")

    out_root = Path(os.environ.get("SMDC_RUNTIME_SCAN_OUT", "") or "runtime-output")
    session_dir = out_root / f"{capture_type}-{int(time.time())}"
    install_dir = session_dir / "install"
    dump_dir = session_dir / "dump"

    install_probe = _flow_text(definition, "nextProbe", "__install_alliance_rpc_hooks__")
    dump_probe = _flow_text(definition, "dumpProbe", "__dump_rpc_captures__")
    dump_probes = _flow_string_list(definition, "dumpProbes") or [dump_probe]
    install_prelude = _flow_string_list(definition, "installPreludeProbes")
    post_install_probes = _flow_string_list(definition, "postInstallProbes")
    seconds_install = _flow_int_env("SMDC_RUNTIME_SCAN_INSTALL_SECONDS", definition, "installSeconds", 120)
    seconds_dump = _flow_int_env("SMDC_RUNTIME_SCAN_DUMP_SECONDS", definition, "dumpSeconds", 10)
    trigger_wait = _flow_int_env("SMDC_RUNTIME_SCAN_TRIGGER_WAIT_SECONDS", definition, "triggerWaitSeconds", 8)
    exit_after_probes = _bool_env_default("SMDC_RUNTIME_SCAN_EXIT_AFTER_PROBES", True)
    install_probes = [*install_prelude, install_probe, *post_install_probes]
    expected_install_probes = [
        probe
        for probe in install_probes
        if probe == "__install_alliance_rpc_hooks__"
        or probe == "__install_season_rpc_hooks__"
        or probe == "__install_battle_listener_hooks__"
        or probe.startswith("__install_rpc_hook__:")
    ]
    install_exit_after_probes = exit_after_probes and not post_install_probes

    max_attempts = _flow_int_env("SMDC_RUNTIME_SCAN_MAX_ATTEMPTS", definition, "maxScanAttempts", 3)
    retry_delay = _flow_int_env("SMDC_RUNTIME_SCAN_RETRY_DELAY_SECONDS", definition, "retryDelaySeconds", 2)
    attempt_warnings: list[str] = []
    records: list[dict[str, Any]] = []
    for attempt in range(1, max_attempts + 1):
        attempt_dir = session_dir / f"attempt-{attempt}" if max_attempts > 1 else session_dir
        attempt_install_dir = attempt_dir / "install"
        attempt_dump_dir = attempt_dir / "dump"
        attempt_install_dir.mkdir(parents=True, exist_ok=True)
        attempt_dump_dir.mkdir(parents=True, exist_ok=True)

        install_warning: str | None = None
        install_started = time.monotonic()
        try:
            _run_runtime_scan(
                process,
                attempt_install_dir,
                install_probes,
                seconds_install,
                definition,
                install_exit_after_probes,
            )
        except RuntimeScanTimeoutError:
            # Attach/injection hung inside the game process (likely a wedged
            # frida agent). Retrying against the same process would only hang
            # again — fail fast and tell the user to restart the game.
            raise
        except RuntimeProbeError as exc:
            install_warning = str(exc)
        install_elapsed = time.monotonic() - install_started
        post_install_wait = max(trigger_wait - install_elapsed, 0)
        (attempt_dir / "trigger-window.txt").write_text(
            (
                f"attempt {attempt}/{max_attempts}; "
                f"hook install max window {seconds_install} seconds; "
                f"actual install window {install_elapsed:.1f} seconds; "
                f"install exit after probes {install_exit_after_probes}; "
                f"post install probes {post_install_probes}; "
                f"install warning {install_warning or ''}; "
                f"dump exit after probes {exit_after_probes}; "
                f"post-install wait {post_install_wait:.1f} seconds before dump\n"
            ),
            encoding="utf-8",
        )
        if post_install_wait > 0:
            time.sleep(post_install_wait)
        try:
            _run_runtime_scan(
                process, attempt_dump_dir, dump_probes, seconds_dump, definition, exit_after_probes
            )
        except RuntimeScanTimeoutError:
            # Same wedged-process failure mode as the install phase: fail fast.
            raise
        except RuntimeProbeError as exc:
            attempt_warnings.append(f"attempt {attempt} dump failed: {exc}")
            if attempt < max_attempts:
                time.sleep(retry_delay)
                continue
            raise
        _validate_runtime_scan_summary(attempt_dump_dir, [])
        records = _read_records_from_directory(attempt_dump_dir)
        if records:
            install_dir = attempt_install_dir
            dump_dir = attempt_dump_dir
            if install_warning:
                attempt_warnings.append(f"attempt {attempt} install warning: {install_warning}")
            break
        if attempt < max_attempts:
            time.sleep(retry_delay)

    if not records:
        install_dir = attempt_install_dir
        dump_dir = attempt_dump_dir
        _validate_runtime_scan_summary(install_dir, expected_install_probes)
        raise RuntimeProbeError(
            f"runtime scan completed but produced no capture records in {dump_dir} "
            f"after {max_attempts} attempts; hooks installed but the game never sent the "
            "target RPC — open the alliance member page in game during the trigger window, "
            "or inspect summary.json"
        )
    install_warning = " | ".join(attempt_warnings) or None
    try:
        _validate_runtime_scan_summary(install_dir, expected_install_probes)
    except RuntimeProbeError as exc:
        install_warning = install_warning or str(exc)
        (session_dir / "install-warning.txt").write_text(install_warning, encoding="utf-8")
    digest = _directory_sha256(dump_dir)
    captured_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())
    return RuntimeProbeResult(
        capture_type=capture_type,
        mode="runtime_scan",
        artifact_type=_artifact_type(definition),
        source=str(dump_dir),
        captured_at=captured_at,
        records=records,
        sha256=digest,
    )


def _validate_runtime_scan_summary(dump_dir: Path, expected_probes: list[str]) -> None:
    summary_path = dump_dir / "summary.json"
    if not summary_path.is_file():
        raise RuntimeProbeError(f"runtime scan did not write summary.json in {dump_dir}")
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeProbeError(f"runtime scan summary is invalid JSON: {summary_path}") from exc

    _validate_runtime_scan_summary_data(summary, expected_probes)


def _validate_runtime_scan_summary_data(summary: dict[str, Any], expected_probes: list[str]) -> None:
    counts = summary.get("counts", {}) if isinstance(summary, dict) else {}

    message_types = counts.get("messageTypes", {}) if isinstance(counts, dict) else {}
    if not isinstance(message_types, dict):
        message_types = {}
    payload_types = counts.get("payloadTypes", {}) if isinstance(counts, dict) else {}
    if not isinstance(payload_types, dict):
        payload_types = {}

    failure_types = [
        key
        for key in ("missing-symbol", "error", "lua-probe-error")
        if int(payload_types.get(key, 0) or 0) > 0 or int(message_types.get(key, 0) or 0) > 0
    ]
    if failure_types:
        raise RuntimeProbeError(
            "runtime scan probe failed: " + ", ".join(sorted(failure_types))
        )

    missing_symbols = summary.get("missingSymbols", [])
    if isinstance(missing_symbols, list) and missing_symbols:
        raise RuntimeProbeError(f"runtime scan missing symbols: {missing_symbols[:5]}")

    hook_count = int(payload_types.get("hook", 0) or 0) + int(payload_types.get("native-hook", 0) or 0)
    if expected_probes and hook_count == 0:
        raise RuntimeProbeError(
            "runtime scan did not install any hooks for probes "
            + ", ".join(expected_probes)
        )


def _run_runtime_scan(
    process: str,
    out_dir: Path,
    probes: list[str],
    seconds: int,
    definition: dict[str, Any],
    exit_after_lua_probes: bool,
) -> None:
    command, shell, cwd = _build_runtime_scan_command(
        process,
        out_dir,
        probes,
        seconds,
        definition,
        exit_after_lua_probes,
    )
    (out_dir / "runtime-scan.command.json").write_text(
        json.dumps(
            {
                "command": command,
                "shell": shell,
                "cwd": str(cwd) if cwd else None,
                "process": process,
                "probes": probes,
                "seconds": seconds,
                "exitAfterLuaProbes": exit_after_lua_probes,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    try:
        # P0-3 修复：父进程以 text/utf-8 读取子进程 stdout，但子进程（frida 扫描
        # 脚本）默认继承系统 locale 编码（中文 Windows 是 cp936）。若子进程 print
        # 含中文的 JSON，会按 cp936 编码写出字节，而父进程按 utf-8 解码 → 日志乱码；
        # 个别超出 cp936 的字符还会触发 UnicodeEncodeError 非 0 退出，被误报为
        # "runtime scan command failed"。注入 PYTHONIOENCODING=utf-8 从源头统一编码。
        scan_env = dict(os.environ)
        scan_env["PYTHONIOENCODING"] = "utf-8"
        with subprocess.Popen(
            command,
            shell=shell,
            cwd=str(cwd) if cwd else None,
            text=True,
            encoding="utf-8",
            errors="replace",
            # P2-6 修复：scan 子进程绝不能继承 sidecar 的 stdin 管道。
            # sidecar 由 Rust 以 stdin=pipe 启动，frida 扫描脚本子进程若继承该
            # 管道，attach 阶段会被挂起的管道句柄阻塞（表现：0 字节输出 +
            # 50s 超时，手动直跑却 1.6s 成功）。断开 stdin 后 install/dump 全链路
            # 恢复（实测产出 4.88MB RPC dump）。
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=scan_env,
            **_subprocess_no_window_kwargs(),
        ) as proc:
            # P0-1 修复：登记 pid，供 sidecar 在 stop/EOF 退出前按 pid 强杀回收，
            # 避免 frida 扫描脚本成为孤儿进程。
            _register_scan_proc(proc.pid)
            try:
                # P0-1 修复：若已收到中止信号（stop/EOF），直接终止，不再启动/继续。
                if scan_aborted():
                    raise RuntimeProbeError("runtime scan was aborted before start")
                stdout, stderr = proc.communicate(timeout=_runtime_scan_timeout(seconds))
                completed = subprocess.CompletedProcess(
                    args=command,
                    returncode=proc.returncode,
                    stdout=stdout,
                    stderr=stderr,
                )
            except subprocess.TimeoutExpired:
                # P2-5 修复（v3）：subprocess.run 的 TimeoutExpired 在 Python 3.13
                # 没有 process 属性（except 里访问 exc.process 会二次崩溃）。
                # 改用 Popen + communicate(timeout)：超时后 proc 仍在作用域内，
                # 直接 kill 直接子进程（frida 扫描脚本），绝不碰游戏进程树
                # （taskkill /T 会连游戏一起杀）。kill 失败静默。
                try:
                    proc.kill()
                except OSError:
                    pass
                # 兜底清理 frida 扫描脚本可能派生的残留子进程（杀 proc 的进程树，
                # 不 kill 游戏进程本身——process 参数是游戏 pid，绝不能传给它）。
                try:
                    _kill_process_tree(proc.pid)
                except Exception:  # noqa: BLE001 - 清理失败不影响主流程
                    pass
                try:
                    stdout, stderr = proc.communicate(timeout=5)
                except (subprocess.TimeoutExpired, OSError):
                    stdout, stderr = None, None
                (out_dir / "runtime-scan.stdout.log").write_text(stdout or "", encoding="utf-8")
                (out_dir / "runtime-scan.stderr.log").write_text(stderr or "", encoding="utf-8")
                raise RuntimeScanTimeoutError(
                    f"runtime scan command timed out after {_runtime_scan_timeout(seconds)} seconds "
                    f"for probes {', '.join(probes)}; frida attach is likely stuck in the game "
                    "process — fully quit and restart the game, then retry the capture"
                )
            finally:
                # P0-1 修复：无论正常完成、超时还是中止，都注销已登记的 pid。
                _unregister_scan_proc()
    except RuntimeScanTimeoutError:
        raise
    except Exception:  # noqa: BLE001 - Popen 构造/IO 失败应转成可读错误
        raise RuntimeProbeError(f"failed to run runtime scan command for probes {', '.join(probes)}")
    (out_dir / "runtime-scan.stdout.log").write_text(completed.stdout or "", encoding="utf-8")
    (out_dir / "runtime-scan.stderr.log").write_text(completed.stderr or "", encoding="utf-8")
    if completed.returncode != 0:
        probe_label = ", ".join(probes)
        raise RuntimeProbeError(
            f"runtime scan command failed ({completed.returncode}) for probes {probe_label}: "
            f"{(completed.stderr or completed.stdout).strip()}"
        )


def _runtime_scan_timeout(seconds: int) -> int:
    grace_text = os.environ.get("SMDC_RUNTIME_SCAN_TIMEOUT_GRACE_SECONDS", "").strip()
    try:
        grace = int(float(grace_text)) if grace_text else 30
    except ValueError:
        grace = 30
    return max(seconds + grace, 30)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise RuntimeProbeError(f"runtime probe line {line_number} is not an object")
            records.append(value)
    return records


def _read_records_from_directory(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for file_path in sorted(path.rglob("*")):
        if not file_path.is_file():
            continue
        suffix = file_path.suffix.lower()
        if suffix == ".jsonl":
            records.extend(_read_records_from_jsonl_file(file_path))
        elif suffix == ".json":
            records.extend(_records_from_json(file_path))
        elif suffix == ".bin":
            records.extend(_records_from_lua_string_dump(file_path))
    return records


def _read_records_from_jsonl_file(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for item in _read_jsonl(path):
        decoded = _decode_rpc_record(item)
        if _looks_like_rpc_record(decoded):
            records.append(decoded)
    return records


def _records_from_json(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, list):
        return [
            item
            for item in (_decode_rpc_record(item) for item in value)
            if _looks_like_rpc_record(item)
        ]
    if isinstance(value, dict):
        if isinstance(value.get("captures"), list):
            return [
                item
                for item in (_decode_rpc_record(item) for item in value["captures"])
                if _looks_like_rpc_record(item)
            ]
        if isinstance(value.get("records"), list):
            return [
                item
                for item in (_decode_rpc_record(item) for item in value["records"])
                if _looks_like_rpc_record(item)
            ]
        decoded = _decode_rpc_record(value)
        return [decoded] if _looks_like_rpc_record(decoded) else []
    return []


def _records_from_lua_string_dump(path: Path) -> list[dict[str, Any]]:
    data = path.read_bytes()
    if not data or len(data) > _int_env("SMDC_RUNTIME_SCAN_PARSE_MAX_BYTES", 64 * 1024 * 1024):
        return []
    text = data.decode("utf-8", errors="replace").replace("\x00", "").strip()
    if not text or text[0] not in "[{":
        return []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        if text.startswith("["):
            return [
                item
                for item in (_decode_rpc_record(item) for item in _recover_json_array_objects(text))
                if _looks_like_rpc_record(item)
            ]
        return []
    if isinstance(value, list):
        return [
            item
            for item in (_decode_rpc_record(item) for item in value)
            if _looks_like_rpc_record(item)
        ]
    decoded = _decode_rpc_record(value)
    return [decoded] if _looks_like_rpc_record(decoded) else []


def _recover_json_array_objects(text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    depth = 0
    start: int | None = None
    in_string = False
    escaped = False
    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            if depth == 0:
                continue
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    value = json.loads(text[start : index + 1])
                except json.JSONDecodeError:
                    start = None
                    continue
                if isinstance(value, dict):
                    records.append(value)
                start = None
    return records


def _decode_rpc_record(record: Any) -> dict[str, Any] | None:
    if not isinstance(record, dict):
        return None
    decoded = dict(record)
    for key in ("args", "returns"):
        value = decoded.get(key)
        if isinstance(value, str):
            decoded[key] = _decode_json_text(value)
    return decoded


def _decode_json_text(value: str) -> Any:
    text = value.strip()
    for _ in range(2):
        if not text or text[0] not in "[{\"0123456789tfn-":
            return value
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return value
        if isinstance(parsed, str):
            text = parsed.strip()
            value = parsed
            continue
        return parsed
    return value


def _looks_like_rpc_record(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    if isinstance(record.get("module"), str) and isinstance(record.get("func"), str):
        return True
    if isinstance(record.get("sourceModule"), str) and isinstance(record.get("sourceFunc"), str):
        return True
    return False


def _runtime_scan_status() -> dict[str, Any]:
    process_configured = os.environ.get("SMDC_RUNTIME_SCAN_PROCESS", "").strip()
    process_candidates = _find_nslg_process_candidates()
    process_target = process_configured or (
        str(process_candidates[0]["pid"]) if process_candidates else ""
    )
    external_overrides_enabled = _external_runtime_scan_overrides_enabled()
    configured_script = os.environ.get("SMDC_RUNTIME_SCAN_SCRIPT", "").strip()
    configured_cwd = os.environ.get("SMDC_RUNTIME_SCAN_CWD", "").strip()
    configured_command = os.environ.get("SMDC_RUNTIME_SCAN_COMMAND", "").strip()
    script_path = _runtime_scan_script_path()
    cwd = _runtime_scan_cwd(script_path)
    command_template = configured_command if external_overrides_enabled else ""
    out_root = os.environ.get("SMDC_RUNTIME_SCAN_OUT", "").strip() or "runtime-output"
    issues: list[str] = []

    if not process_target:
        issues.append("no NSLG process found and SMDC_RUNTIME_SCAN_PROCESS is not set")
    if script_path and not script_path.is_file():
        issues.append(f"runtime scan script not found: {script_path}")
    if cwd and not cwd.is_dir():
        issues.append(f"runtime scan cwd not found: {cwd}")
    if not command_template and not (script_path and script_path.is_file()):
        issues.append("SMDC_RUNTIME_SCAN_COMMAND is not set and no runtime scan script was found")
    if not _python_frida_available():
        issues.append("python frida package is not available")

    return {
        "enabled": runtime_probe_enabled(),
        "mode": "runtime_scan",
        "ready": not issues,
        "issues": issues,
        "source": out_root,
        "outputRoot": out_root,
        "processConfigured": process_configured,
        "processTarget": process_target,
        "processFound": bool(process_candidates) if not process_configured else _process_target_found(process_configured, process_candidates),
        "processCandidates": process_candidates[:8],
        "externalOverridesEnabled": external_overrides_enabled,
        "commandConfigured": bool(configured_command and external_overrides_enabled),
        "commandOverrideIgnored": bool(configured_command and not external_overrides_enabled),
        "scriptConfigured": bool(configured_script and external_overrides_enabled),
        "scriptOverrideIgnored": bool(configured_script and not external_overrides_enabled),
        "scriptPath": str(script_path) if script_path else "",
        "scriptExists": bool(script_path and script_path.is_file()),
        "cwdConfigured": bool(configured_cwd and external_overrides_enabled),
        "cwdOverrideIgnored": bool(configured_cwd and not external_overrides_enabled),
        "cwd": str(cwd) if cwd else "",
        "cwdExists": bool(cwd and cwd.is_dir()),
        "python": os.environ.get("SMDC_RUNTIME_SCAN_PYTHON", "").strip() or sys.executable,
        "fridaAvailable": _python_frida_available(),
    }


def _build_runtime_scan_command(
    process: str,
    out_dir: Path,
    probes: list[str],
    seconds: int,
    definition: dict[str, Any],
    exit_after_lua_probes: bool,
) -> tuple[str | list[str], bool, Path | None]:
    command_template = (
        os.environ.get("SMDC_RUNTIME_SCAN_COMMAND", "").strip()
        if _external_runtime_scan_overrides_enabled()
        else ""
    )
    script_path = _runtime_scan_script_path()
    cwd = _runtime_scan_cwd(script_path)
    max_hook_bytes = _flow_int_env(
        "SMDC_RUNTIME_SCAN_MAX_HOOK_BYTES", definition, "maxHookBytes", 32 * 1024 * 1024
    )
    max_lua_string_bytes = _flow_int_env(
        "SMDC_RUNTIME_SCAN_MAX_LUA_STRING_BYTES",
        definition,
        "maxLuaStringBytes",
        32 * 1024 * 1024,
    )
    if command_template:
        probe_args = " ".join(
            f"--lua-probe-module {shlex.quote(probe)}" for probe in probes
        )
        try:
            rendered = command_template.format(
                process=shlex.quote(process),
                out=shlex.quote(str(out_dir)),
                probe=shlex.quote(probes[-1] if probes else ""),
                probeArgs=probe_args,
                probe_args=probe_args,
                seconds=str(seconds),
                maxHookBytes=str(max_hook_bytes),
                max_hook_bytes=str(max_hook_bytes),
                maxLuaStringBytes=str(max_lua_string_bytes),
                max_lua_string_bytes=str(max_lua_string_bytes),
                exitAfterLuaProbes="--exit-after-lua-probes" if exit_after_lua_probes else "",
                exit_after_lua_probes="--exit-after-lua-probes" if exit_after_lua_probes else "",
            )
        except (KeyError, ValueError) as exc:
            # P2-5 修复：外部命令模板含未知占位符时给出可读配置错误，
            # 而不是让 KeyError 冒泡成半成品失败。
            raise RuntimeProbeError(
                f"SMDC_RUNTIME_SCAN_COMMAND 模板包含不支持的占位符：{exc}；"
                "支持的占位符：{process} {out} {probe} {probeArgs} {seconds} "
                "{maxHookBytes} {maxLuaStringBytes} {exitAfterLuaProbes}"
            ) from exc
        return (
            rendered,
            True,
            cwd,
        )
    if script_path and script_path.is_file():
        python_exe = os.environ.get("SMDC_RUNTIME_SCAN_PYTHON", "").strip() or sys.executable
        command = [
            python_exe,
            str(script_path),
            "--process",
            process,
            "--out",
            str(out_dir),
            "--no-scan",
            "--no-loadbuffer-hooks",
            "--seconds",
            str(seconds),
            "--max-hook-bytes",
            str(max_hook_bytes),
            "--max-lua-string-bytes",
            str(max_lua_string_bytes),
        ]
        for probe in probes:
            command.extend(["--lua-probe-module", probe])
        if exit_after_lua_probes:
            command.append("--exit-after-lua-probes")
        return (command, False, cwd)
    raise RuntimeProbeError("embedded runtime scan script was not found; external scan fallback is disabled")


def _runtime_scan_script_path() -> Path | None:
    configured = os.environ.get("SMDC_RUNTIME_SCAN_SCRIPT", "").strip()
    if configured and _external_runtime_scan_overrides_enabled():
        return Path(configured)

    here = Path(__file__).resolve().parent
    root = here.parent
    candidates = [
        here / "frida_nslg_runtime_scan.py",
        root / "collector" / "frida_nslg_runtime_scan.py",
        root / "scripts" / "frida_nslg_runtime_scan.py",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def _runtime_scan_cwd(script_path: Path | None) -> Path | None:
    configured = os.environ.get("SMDC_RUNTIME_SCAN_CWD", "").strip()
    if configured and _external_runtime_scan_overrides_enabled():
        return Path(configured)
    if script_path and script_path.is_file():
        return script_path.parent
    return None


def _find_nslg_process_candidates() -> list[dict[str, Any]]:
    hints = [
        item.strip().lower().removesuffix(".exe")
        for item in os.environ.get(
            "SMDC_RUNTIME_SCAN_PROCESS_HINTS",
            "com.bilibili.nslg,nslg,nslg.exe,com.bilibili.nslg.exe",
        ).split(",")
        if item.strip()
    ]
    # 用 bytes 模式跑 tasklist：中文 Windows 输出是 GBK，utf-8 reader 线程解码
    # 崩溃会让 completed.stdout 变 None（且主线程 except 拦不住 reader 线程异常），
    # 改为 bytes + 手动探测解码（优先 utf-8，失败回退 cp936），彻底规避。
    try:
        completed = subprocess.run(
            ["tasklist", "/fo", "csv", "/nh"],
            capture_output=True,
            check=False,
            timeout=15,
            **_subprocess_no_window_kwargs(),
        )
    except OSError:
        return []
    except subprocess.TimeoutExpired:
        return []
    if not completed or not completed.stdout:
        return []
    raw = completed.stdout
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp936", errors="replace")
    rows = csv.reader(text.splitlines())
    candidates: list[dict[str, Any]] = []
    for row in rows:
        if len(row) < 2:
            continue
        image = row[0].strip()
        image_key = image.lower().removesuffix(".exe")
        if not any(hint in image_key for hint in hints):
            continue
        try:
            pid = int(row[1])
        except ValueError:
            continue
        priority = min((index for index, hint in enumerate(hints) if hint in image_key), default=99)
        candidates.append({"name": image, "pid": pid, "priority": priority, "source": "tasklist"})
    candidates.sort(key=lambda item: (int(item["priority"]), str(item["name"]).lower(), int(item["pid"])))
    return candidates


def _process_target_found(process: str, candidates: list[dict[str, Any]]) -> bool:
    if process.isdigit():
        return any(str(item.get("pid")) == process for item in candidates)
    normalized = process.lower().removesuffix(".exe")
    return any(normalized in str(item.get("name", "")).lower().removesuffix(".exe") for item in candidates)


def _python_frida_available() -> bool:
    try:
        __import__("frida")
        return True
    except Exception:
        return False


def _directory_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        hasher.update(str(file_path.relative_to(path)).encode("utf-8"))
        # P2-6 修复：大 dump 文件若整体 read_bytes() 会让内存峰值等于全部文件
        # 字节数。改为分块 update()，常驻内存仅一个 chunk。
        with file_path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                hasher.update(chunk)
    return hasher.hexdigest()


def _artifact_type(definition: dict[str, Any]) -> str:
    expected = definition.get("expectedArtifacts")
    if isinstance(expected, list):
        for item in expected:
            if item == "rpc_dump":
                return "runtime_rpc_dump"
    return "runtime_evidence"


def _flow_text(definition: dict[str, Any], key: str, fallback: str) -> str:
    value = definition.get(key)
    return value if isinstance(value, str) and value else fallback


def _flow_int(definition: dict[str, Any], key: str, fallback: int) -> int:
    value = definition.get(key)
    if isinstance(value, int) and value > 0:
        return value
    return fallback


def _flow_string_list(definition: dict[str, Any], key: str) -> list[str]:
    value = definition.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _flow_int_env(env_key: str, definition: dict[str, Any], key: str, fallback: int) -> int:
    configured = os.environ.get(env_key, "").strip()
    if configured:
        try:
            value = int(float(configured))
            if value > 0:
                return value
        except ValueError:
            pass
    return _flow_int(definition, key, fallback)


def _int_env(env_key: str, fallback: int) -> int:
    configured = os.environ.get(env_key, "").strip()
    if configured:
        try:
            value = int(float(configured))
            if value > 0:
                return value
        except ValueError:
            pass
    return fallback


def _bool_env_default(env_key: str, fallback: bool) -> bool:
    configured = os.environ.get(env_key, "").strip().lower()
    if not configured:
        return fallback
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        return False
    return fallback
