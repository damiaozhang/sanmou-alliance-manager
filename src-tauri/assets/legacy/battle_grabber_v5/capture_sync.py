from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


@dataclass
class CaptureArtifact:
    meta_path: Path
    local_meta_path: Path
    proto_name: str
    msg_id: int
    local_dir: Path
    parsed_events_path: Path | None = None
    events_path: Path | None = None
    render_source_path: Path | None = None
    emit_packet: bool = True


class CaptureSync:
    def __init__(self, remote_dir: Path, local_dir: Path, config: dict[str, Any]):
        self.remote_dir = remote_dir
        self.local_dir = local_dir
        self.config = config
        self.render_msg_ids = {int(value) for value in self.config.get("render_msg_ids", [1008])}
        self.emitted_meta: set[Path] = set()
        self.completed_meta: set[Path] = set()
        self.session_start_ts = float(self.config.get("session_start_ts") or 0.0)
        self.bootstrap_slack_sec = float(self.config.get("bootstrap_slack_sec") or 1.0)
        self.local_dir.mkdir(parents=True, exist_ok=True)
        if bool(self.config.get("ignore_existing_on_start", True)):
            try:
                existing = set(self._bootstrap_seen_meta())
                self.emitted_meta.update(existing)
                self.completed_meta.update(existing)
            except OSError:
                pass

    def sync_once(self) -> list[CaptureArtifact]:
        artifacts: list[CaptureArtifact] = []
        try:
            if not self.remote_dir.exists():
                return artifacts
        except OSError:
            return artifacts

        try:
            self._copy_trace()
            meta_files = list(self._iter_meta_files())
        except OSError:
            return artifacts

        for meta_path in meta_files:
            if meta_path in self.completed_meta:
                continue
            artifact = self._sync_meta_set(meta_path)
            if artifact is not None:
                first_seen = meta_path not in self.emitted_meta
                artifact.emit_packet = first_seen
                self.emitted_meta.add(meta_path)
                artifact.render_source_path = _pick_render_source(artifact)

                needs_render = artifact.msg_id in self.render_msg_ids
                has_render_inputs = artifact.render_source_path is not None

                if needs_render and not has_render_inputs:
                    # Emit the packet once now, but revisit on later sync passes until the
                    # delayed event JSON files appear so report rendering can still happen.
                    if first_seen:
                        artifacts.append(artifact)
                    continue

                self.completed_meta.add(meta_path)
                artifacts.append(artifact)
        return artifacts

    def _iter_meta_files(self) -> Iterable[Path]:
        target_ids = {int(value) for value in self.config.get("target_msg_ids", [1008])}
        for path in sorted(self.remote_dir.glob("*_recv_*_*.meta.json"), key=_artifact_sort_key):
            msg_id = _msg_id_from_name(path.name)
            if msg_id is not None and msg_id in target_ids:
                yield path

    def _bootstrap_seen_meta(self) -> Iterable[Path]:
        if self.session_start_ts <= 0:
            yield from self._iter_meta_files()
            return

        cutoff_ts = self.session_start_ts - self.bootstrap_slack_sec
        for path in self._iter_meta_files():
            artifact_ts = _artifact_timestamp(path)
            if artifact_ts is not None:
                if artifact_ts < cutoff_ts:
                    yield path
                continue
            if _file_mtime(path) < cutoff_ts:
                yield path

    def _sync_meta_set(self, meta_path: Path) -> CaptureArtifact | None:
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            return None

        msg_id = int(meta.get("msgId") or _msg_id_from_name(meta_path.name) or 0)
        proto_name = str(meta.get("protoName") or _proto_from_name(meta_path.name) or "")
        prefix = meta_path.name.removesuffix(".meta.json")
        target = self.local_dir / prefix
        target.mkdir(parents=True, exist_ok=True)

        copied: dict[str, Path] = {}
        for source in self._files_from_meta(meta, meta_path):
            local = self._copy_file(source, target, prefix)
            if local is not None:
                copied[source.name] = local

        local_meta = self._copy_file(meta_path, target, prefix)
        if local_meta is None:
            return None

        parsed = _first_path(copied.values(), ".parsed_events.json")
        events = _first_path(copied.values(), ".events.json")
        return CaptureArtifact(
            meta_path=meta_path,
            local_meta_path=local_meta,
            proto_name=proto_name,
            msg_id=msg_id,
            local_dir=target,
            parsed_events_path=parsed,
            events_path=events,
        )

    def _files_from_meta(self, meta: dict[str, Any], meta_path: Path) -> list[Path]:
        files: list[Path] = []
        prefix = meta_path.name.removesuffix(".meta.json")
        for key in ("contentFile", "packetFile"):
            value = meta.get(key)
            if value:
                files.append(_path_from_capture_value(value, meta_path.parent))

        decoded = meta_path.with_name(meta_path.name.removesuffix(".meta.json") + ".decoded.json")
        if decoded.exists():
            files.append(decoded)

        for field in meta.get("binaryFields") or []:
            if not isinstance(field, dict):
                continue
            for key in (
                "file",
                "streamJson",
                "protoJson",
                "eventsJson",
                "parsedEventsJson",
                "unzippedFile",
            ):
                value = field.get(key)
                if value:
                    files.append(_path_from_capture_value(value, meta_path.parent))

        try:
            files.extend(meta_path.parent.glob(prefix + "*"))
        except OSError:
            pass
        return _dedupe_paths(files)

    def _copy_trace(self) -> None:
        trace = self.remote_dir / "trace.log"
        if trace.exists():
            self._copy_file(trace, self.local_dir)

    @staticmethod
    def _copy_file(source: Path, target_dir: Path, prefix: str | None = None) -> Path | None:
        try:
            if not source.exists() or not source.is_file():
                return None
        except OSError:
            return None
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / _local_name_for_source(source.name, prefix)
            if target.exists():
                try:
                    if target.stat().st_size == source.stat().st_size and target.stat().st_mtime >= source.stat().st_mtime:
                        return target
                except OSError:
                    pass
            shutil.copy2(source, target)
            return target
        except OSError:
            return None


def _path_from_capture_value(value: Any, base_dir: Path) -> Path:
    text = str(value)
    path = Path(text)
    if path.is_absolute():
        return path
    return base_dir / text


def _dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path)
        if key not in seen:
            seen.add(key)
            result.append(path)
    return result


def _msg_id_from_name(name: str) -> int | None:
    parts = name.split("_recv_")
    if len(parts) < 2:
        return None
    tail = parts[1].split("_", 1)[0]
    try:
        return int(tail)
    except ValueError:
        return None


def _proto_from_name(name: str) -> str | None:
    marker = "_recv_"
    if marker not in name:
        return None
    tail = name.split(marker, 1)[1]
    pieces = tail.split("_", 1)
    if len(pieces) != 2:
        return None
    return pieces[1].removesuffix(".meta.json")


def _first_path(paths: Iterable[Path], suffix: str) -> Path | None:
    for path in paths:
        if path.name.endswith(suffix):
            return path
    return None


def _local_name_for_source(name: str, prefix: str | None) -> str:
    if not prefix:
        return name
    local_prefix = _artifact_local_prefix(prefix)
    for marker in (prefix + ".", prefix + "_"):
        if name.startswith(marker):
            shortened = name[len(marker) :]
            if shortened:
                separator = "." if marker.endswith(".") else "_"
                return f"{local_prefix}{separator}{shortened}"
    return name


def _artifact_local_prefix(prefix: str) -> str:
    head = prefix.split("_recv_", 1)[0]
    return head or prefix


def _pick_render_source(artifact: CaptureArtifact) -> Path | None:
    for candidate in (artifact.parsed_events_path, artifact.events_path):
        if candidate is not None and _json_file_ready(candidate):
            return candidate
    return None


def _json_file_ready(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return False
    return isinstance(payload, (dict, list))


def _artifact_sort_key(path: Path) -> tuple[float, str]:
    timestamp = _artifact_timestamp(path)
    if timestamp is not None:
        return (timestamp, path.name)
    return (_file_mtime(path), path.name)


def _artifact_timestamp(path: Path) -> float | None:
    prefix = path.name[:15]
    if len(prefix) != 15 or prefix[8] != "_":
        return None
    try:
        return datetime.strptime(prefix, "%Y%m%d_%H%M%S").timestamp()
    except ValueError:
        return None


def _file_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
