from __future__ import annotations

import json
import csv
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from typing import Any, Callable


LogFn = Callable[[str], None]


def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def load_hook_source() -> str:
    js_path = resource_path("frida_passive_battle_capture.js")
    lua_path = resource_path("capture_passive_battle_packets.lua")
    source = js_path.read_text(encoding="utf-8")
    lua = lua_path.read_text(encoding="utf-8")
    return source.replace("__LUA_PAYLOAD__", json.dumps(lua))


@dataclass
class ProtocolCapture:
    config: dict[str, Any]
    log: LogFn = print
    session: Any = None
    script: Any = None
    device: Any = None
    process_info: dict[str, Any] | None = None
    remote_capture_dir: Path | None = None
    installed: bool = False
    messages: list[dict[str, Any]] = field(default_factory=list)

    def start(self) -> dict[str, Any]:
        try:
            import frida  # type: ignore
        except ImportError as exc:
            raise RuntimeError("Frida is not installed. Run: pip install frida") from exc

        self.device = frida.get_local_device()
        candidates = self._find_process_candidates()
        if not candidates:
            names = ", ".join(self.config.get("game_process", []))
            raise RuntimeError(f"Game process not found: {names}")

        errors: list[str] = []
        hook_source = load_hook_source()
        for process in candidates:
            self.process_info = {"pid": process.pid, "name": process.name}
            self.log(f"[protocol] attaching to {process.name} ({process.pid})")
            session: Any | None = None
            try:
                session = self.device.attach(process.pid)
                script = session.create_script(hook_source)
                script.on("message", self._on_message)
                script.load()
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{process.name}({process.pid}): {exc}")
                self.log(f"[protocol] attach failed for {process.name} ({process.pid}): {exc}")
                if session is not None:
                    try:
                        session.detach()
                    except Exception:
                        pass
                self.session = None
                self.script = None
                continue

            self.session = session
            self.script = script
            self.log("[protocol] hook loaded; waiting for Lua payload install")
            return self.process_info

        raise RuntimeError("Game process attach failed: " + "; ".join(errors))

    def wait_until_installed(self, timeout_sec: float = 30.0, interval_sec: float = 1.0) -> bool:
        deadline = time.time() + max(0.1, timeout_sec)
        while time.time() < deadline:
            if self.installed:
                return True
            self.poll_status()
            time.sleep(max(0.1, interval_sec))
        return self.installed

    def poll_status(self) -> dict[str, Any]:
        if self.script is None:
            return {}
        try:
            status = self.script.exports_sync.status()
            self.log(f"[protocol] status {json.dumps(status, ensure_ascii=False)}")
            self.installed = bool(status.get("payloadInstalled")) or self.installed
            return dict(status)
        except Exception as exc:  # noqa: BLE001
            self.log(f"[protocol] status failed: {exc}")
            return {}

    def run_until_stop(self, stop_event: Event, status_interval_sec: float = 5.0) -> None:
        last_status = 0.0
        while not stop_event.is_set():
            now = time.time()
            if now - last_status >= status_interval_sec:
                last_status = now
                self.poll_status()
            time.sleep(0.25)

    def stop(self) -> None:
        if self.script is not None:
            try:
                self.script.unload()
            except Exception:
                pass
            self.script = None
        if self.session is not None:
            try:
                self.session.detach()
            except Exception:
                pass
            self.session = None
        self.log("[protocol] detached")

    def _find_process_candidates(self) -> list[Any]:
        assert self.device is not None
        processes = self.device.enumerate_processes()
        exact_names = list(self.config.get("game_process", []))
        candidates: list[Any] = []
        seen: set[int] = set()

        def add(process: Any) -> None:
            pid = int(process.pid)
            if pid not in seen:
                seen.add(pid)
                candidates.append(process)

        for name in exact_names:
            for process in processes:
                if process.name == name:
                    add(process)

        fuzzy = str(self.config.get("game_process_fuzzy", "nslg")).lower()
        for process in processes:
            name = process.name.lower()
            if fuzzy and fuzzy in name:
                add(process)
            if "sanmou" in name:
                add(process)
            if "bilibili" in name and "nslg" in name:
                add(process)

        configured_pid = _int_or_none(self.config.get("game_process_pid"))
        if configured_pid is not None:
            add(SimpleNamespace(pid=configured_pid, name=f"pid:{configured_pid}"))

        for process in _windows_process_candidates(self.config):
            add(process)
        return candidates

    def _on_message(self, message: dict[str, Any], data: bytes | None = None) -> None:
        if message.get("type") == "send":
            payload = message.get("payload") or {}
            if isinstance(payload, dict):
                self.messages.append(payload)
                kind = str(payload.get("type", "message"))
                rest = {key: value for key, value in payload.items() if key != "type"}
                if kind == "installed":
                    output = rest.get("output")
                    if output:
                        self.remote_capture_dir = Path(str(output))
                    self.installed = True
                self.log(f"[{kind}] {json.dumps(rest, ensure_ascii=False)}")
            else:
                self.log(f"[protocol] {payload}")
            return

        if message.get("type") == "error":
            self.log(f"[frida-error] {message}")
            return

        self.log(f"[frida-message] {message}")


def _int_or_none(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _hidden_subprocess_kwargs() -> dict[str, Any]:
    if not sys.platform.startswith("win"):
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 0
    return {
        "startupinfo": startupinfo,
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000),
    }


def _windows_process_candidates(config: dict[str, Any]) -> list[Any]:
    if not sys.platform.startswith("win"):
        return []
    try:
        result = subprocess.run(
            ["tasklist", "/fo", "csv", "/nh"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=8,
            **_hidden_subprocess_kwargs(),
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []

    exact = {str(item).lower() for item in (config.get("game_process") or []) if str(item).strip()}
    exact_stems = {item.removesuffix(".exe") for item in exact}
    fuzzy = str(config.get("game_process_fuzzy", "nslg") or "").lower()
    ranked: list[tuple[int, Any]] = []
    for row in csv.reader(result.stdout.splitlines()):
        if len(row) < 2:
            continue
        name = str(row[0] or "").strip()
        pid = _int_or_none(row[1])
        if not name or pid is None:
            continue
        lower = name.lower()
        stem = lower.removesuffix(".exe")
        rank: int | None = None
        if lower in exact or stem in exact or stem in exact_stems:
            rank = 0
        elif "bilibili" in lower and "nslg" in lower:
            rank = 1
        elif fuzzy and fuzzy in lower:
            rank = 2
        elif "sanmou" in lower:
            rank = 3
        if rank is not None:
            ranked.append((rank, SimpleNamespace(pid=pid, name=name)))
    ranked.sort(key=lambda item: (item[0], str(item[1].name).lower(), int(item[1].pid)))
    return [item[1] for item in ranked]
