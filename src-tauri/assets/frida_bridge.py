#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Event, Thread
from typing import Any


BRIDGE_SOURCE_DIR = Path(__file__).resolve().parent
FROZEN_RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", BRIDGE_SOURCE_DIR))

if getattr(sys, "frozen", False):
    ROOT = FROZEN_RESOURCE_ROOT
    AUDIT_ROOT = FROZEN_RESOURCE_ROOT
    V5_ROOT = FROZEN_RESOURCE_ROOT / "battle_grabber_v5"
    V4_ROOT = FROZEN_RESOURCE_ROOT / "battle_grabber_v4"
    TERMS_PATH = FROZEN_RESOURCE_ROOT / "authoritative_terms.json"
else:
    ROOT = Path(__file__).resolve().parents[2]
    AUDIT_ROOT = ROOT.parent
    V5_ROOT = AUDIT_ROOT / "battle_grabber_v5"
    V4_ROOT = AUDIT_ROOT / "battle_grabber_v4"
    TERMS_PATH = BRIDGE_SOURCE_DIR / "authoritative_terms.json"


def _safe_workspace_name(value: str) -> str:
    safe = []
    for ch in value.strip():
        if ch.isascii() and (ch.isalnum() or ch in "._-"):
            safe.append(ch)
        elif "\u4e00" <= ch <= "\u9fff":
            safe.append(ch)
        elif ch.isspace():
            safe.append("_")
        if len(safe) >= 64:
            break
    result = "".join(safe)
    while ".." in result:
        result = result.replace("..", ".")
    return result.strip("._-")


SCAN_WORKSPACE = _safe_workspace_name(os.environ.get("BATTLE_GRABBER_WORKSPACE", ""))
_OUTPUT_ROOT_ENV = os.environ.get("BATTLE_GRABBER_OUTPUT_ROOT", "").strip()
OUTPUT_ROOT = (
    Path(_OUTPUT_ROOT_ENV)
    if _OUTPUT_ROOT_ENV
    else (ROOT / "output" / "workspaces" / SCAN_WORKSPACE if SCAN_WORKSPACE else ROOT / "output")
)
PERSISTENT_ALLIANCE_DIR = OUTPUT_ROOT / "alliance_protocol"
PERSISTENT_ALLIANCE_LATEST = PERSISTENT_ALLIANCE_DIR / "alliance_battles.persist.json"
PERSISTENT_ALLIANCE_JSONL = PERSISTENT_ALLIANCE_DIR / "alliance_battles.persist.jsonl"
REPORTS_INDEX_JSON = OUTPUT_ROOT / "reports.index.json"
REPORTS_INDEX_JSONL = OUTPUT_ROOT / "reports.index.jsonl"
DEFAULT_V5_CONFIG = ROOT / "config.json" if (ROOT / "config.json").exists() else V5_ROOT / "config.json"
DEFAULT_V4_CONFIG = V4_ROOT / "config.json"
STOP_EVENT = Event()
ALLIANCE_PROTOCOL_MSG_IDS = {1004, 1007}
PASSIVE_PROTOCOL_MSG_IDS = {1004, 1007, 1008, 1017}
STRUCTURED_MARKER_START = "<!-- battle-grabber-structured-details:start -->"
STRUCTURED_MARKER_END = "<!-- battle-grabber-structured-details:end -->"
ALLIANCE_HERO_NAME_OVERRIDES: dict[str, str] = {
    "1000": "曹操",
    "1002": "典韦",
    "1008": "荀彧",
    "1009": "司马懿",
    "1014": "乐进",
    "1016": "夏侯渊",
    "1020": "王异",
    "1022": "郝昭",
    "1023": "夏侯惇",
    "1028": "王双",
    "2000": "刘备",
    "2002": "张飞",
    "2003": "诸葛亮",
    "2012": "赵云",
    "2013": "马云禄",
    "2015": "关羽",
    "2017": "魏延",
    "2019": "甘夫人",
    "2021": "姜维",
    "2022": "SP诸葛亮",
    "3000": "孙权",
    "3004": "大乔",
    "3007": "周瑜",
    "3008": "陆逊",
    "3014": "周泰",
    "3016": "陆抗",
    "3018": "SP周瑜",
    "4001": "张辽",
    "4005": "孟获",
    "4006": "祝融夫人",
    "4008": "于吉",
    "4012": "左慈",
    "4015": "马腾",
    "4016": "田丰",
    "4023": "诸葛亮",
    "4024": "张宁",
    "4027": "袁术",
    "4028": "董卓",
    "4030": "皇甫嵩",
    "4031": "张曼成",
    "4032": "孙坚",
    "4033": "木鹿大王",
    "5033": "诸葛瑾",
    "5051": "卢植",
    "5055": "张宝",
}
FORMATION_NAME_OVERRIDES: dict[str, str] = {
    "101": "一字阵",
    "201": "箕形阵",
    "301": "雁形阵",
    "401": "鱼鳞阵",
    "501": "锥形阵",
    "601": "方圆阵",
    "701": "钩行阵",
    "801": "偃月阵",
}


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def emit(event_type: str, **payload: Any) -> None:
    message = {"type": event_type, **payload}
    print(json.dumps(message, ensure_ascii=False), flush=True)


def emit_log(message: str, level: str = "info") -> None:
    emit("log", level=level, message=str(message), timestamp=now_iso())


def emit_error(message: str) -> None:
    emit("error", message=str(message), timestamp=now_iso())


def install_signal_handlers() -> None:
    def _handler(_signum: int, _frame: object) -> None:
        STOP_EVENT.set()

    for signame in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, signame):
            signal.signal(getattr(signal, signame), _handler)


def install_stdin_listener() -> None:
    def _reader() -> None:
        try:
            while not STOP_EVENT.is_set():
                line = sys.stdin.readline()
                if not line:
                    return
                if line.strip().lower() == "stop":
                    emit_log("Stop requested via stdin")
                    STOP_EVENT.set()
                    return
        except Exception as exc:
            emit_log(f"stdin listener stopped: {exc}", "warning")

    Thread(target=_reader, daemon=True).start()


def ensure_import_path(path: Path) -> None:
    text = str(path)
    if text not in sys.path:
        sys.path.insert(0, text)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_write_json(path: Path, obj: Any, indent: int = 2) -> None:
    """P2-7 修复：关键 JSON（reports index / latest / session_summary）原先直接
    write_text，若写入中途崩溃会留下半截 JSON、"最新快照"整体丢失。改为临时文件
    + os.replace 原子落盘。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent), encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def load_authoritative_terms() -> dict[str, dict[str, str]]:
    try:
        payload = load_json(TERMS_PATH)
    except Exception:
        return {}
    terms: dict[str, dict[str, str]] = {}
    for key, value in payload.items():
        if isinstance(value, dict):
            terms[key] = {
                str(item_key): str(item_value).strip()
                for item_key, item_value in value.items()
                if str(item_key).strip() and str(item_value).strip()
            }
    return terms


AUTHORITATIVE_TERMS = load_authoritative_terms()
AUTHORITATIVE_HERO_NAMES = dict(AUTHORITATIVE_TERMS.get("heroes", {}))
AUTHORITATIVE_HERO_NAMES.update(ALLIANCE_HERO_NAME_OVERRIDES)
AUTHORITATIVE_FORMATION_NAMES = dict(AUTHORITATIVE_TERMS.get("formations", {}))
AUTHORITATIVE_FORMATION_NAMES.update(FORMATION_NAME_OVERRIDES)
AUTHORITATIVE_SKILL_NAMES = AUTHORITATIVE_TERMS.get("skills", {})
AUTHORITATIVE_WARBOOK_NAMES = AUTHORITATIVE_TERMS.get("warbooks", {})
AUTHORITATIVE_EQUIPMENT_NAMES = AUTHORITATIVE_TERMS.get("equipment", {})
AUTHORITATIVE_HORSE_NAMES = AUTHORITATIVE_TERMS.get("horses", {})
AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES = AUTHORITATIVE_TERMS.get("equipmentEffects", {})
AUTHORITATIVE_HORSE_EFFECT_NAMES = AUTHORITATIVE_TERMS.get("horseEffects", {})
AUTHORITATIVE_EQUIPMENT_SKILL_NAMES = AUTHORITATIVE_TERMS.get("equipmentSkills", {})
AUTHORITATIVE_HORSE_SKILL_NAMES = AUTHORITATIVE_TERMS.get("horseSkills", {})


def _authoritative_term(term_map: dict[str, str], value_id: str) -> str:
    return term_map.get(str(value_id).strip(), "")


def _formation_name(value_id: str) -> str:
    return _authoritative_term(AUTHORITATIVE_FORMATION_NAMES, value_id)


def _authoritative_asset_attr_name(asset_kind: str, attr_key: str, value_id: str) -> str:
    if asset_kind == "equipment" and attr_key == "skill":
        return _authoritative_term(AUTHORITATIVE_EQUIPMENT_SKILL_NAMES, value_id)
    if asset_kind == "equipment" and attr_key == "effect":
        return _authoritative_term(AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES, value_id)
    if asset_kind == "horse" and attr_key == "skill":
        return _authoritative_term(AUTHORITATIVE_HORSE_SKILL_NAMES, value_id)
    if asset_kind == "horse" and attr_key == "effect":
        return _authoritative_term(AUTHORITATIVE_HORSE_EFFECT_NAMES, value_id)
    return ""


def timestamp_for_file() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def create_session_dir(label: str) -> Path:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_ROOT / f"{label}_{timestamp_for_file()}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def normalise_process_config(config: dict[str, Any], process_name: str | None) -> dict[str, Any]:
    if not process_name:
        return config

    cfg = dict(config)
    if process_name.isdigit():
        cfg["game_process_pid"] = int(process_name)
        cfg["game_process_fuzzy"] = ""
        return cfg

    exact = list(cfg.get("game_process", []))
    if process_name not in exact:
        exact.insert(0, process_name)
    cfg["game_process"] = exact

    fuzzy = process_name.lower().replace(".exe", "")
    cfg["game_process_fuzzy"] = fuzzy if fuzzy and not fuzzy.isdigit() else cfg.get("game_process_fuzzy", "nslg")
    return cfg


def load_v5_config(process_name: str | None) -> dict[str, Any]:
    config = load_json(DEFAULT_V5_CONFIG)
    config["output_dir"] = str(OUTPUT_ROOT)
    config = normalise_process_config(config, process_name)
    protocol = dict(config.get("protocol") or {})
    target_msg_ids = {
        _to_int(value)
        for value in protocol.get("target_msg_ids", [])
    }
    protocol["target_msg_ids"] = sorted(
        value for value in target_msg_ids.union(PASSIVE_PROTOCOL_MSG_IDS) if value is not None
    )
    render_msg_ids = {_to_int(value) for value in protocol.get("render_msg_ids", [1008])}
    protocol["render_msg_ids"] = sorted(value for value in render_msg_ids if value is not None)
    config["protocol"] = protocol
    return config


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


def windows_game_processes(config: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not sys.platform.startswith("win"):
        return []
    try:
        import csv
    except Exception:
        return []

    cfg = config or {}
    exact = {str(item).lower() for item in (cfg.get("game_process") or []) if str(item).strip()}
    exact_stems = {item.removesuffix(".exe") for item in exact}
    fuzzy = str(cfg.get("game_process_fuzzy", "nslg") or "").lower()
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

    ranked: list[tuple[int, dict[str, Any]]] = []
    for row in csv.reader(result.stdout.splitlines()):
        if len(row) < 2:
            continue
        name = str(row[0] or "").strip()
        try:
            pid = int(row[1])
        except (TypeError, ValueError):
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
            ranked.append((rank, {"pid": pid, "name": name}))
    ranked.sort(key=lambda item: (item[0], item[1]["name"].lower(), item[1]["pid"]))
    return [item[1] for item in ranked]


def load_v4_config(process_name: str | None) -> dict[str, Any]:
    config = load_json(DEFAULT_V4_CONFIG)
    config["output_dir"] = str(OUTPUT_ROOT)
    config["diagnostic_mode"] = False
    config["list_scan_mode"] = True
    return normalise_process_config(config, process_name)


def find_alliance_file(base_dir: Path) -> Path | None:
    candidates = sorted(base_dir.rglob("*alliance_battles.latest.json"))
    return candidates[-1] if candidates else None


def load_alliance_records(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(payload, dict):
        records = payload.get("records")
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def read_meta(local_meta_path: Path) -> dict[str, Any]:
    try:
        return json.loads(local_meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_report_payload(json_path: Path | None) -> dict[str, Any]:
    if json_path is None or not json_path.exists():
        return {}
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


ATTR_LABELS = {
    "might": "武力",
    "intelligence": "智力",
    "defence": "统率",
    "defense": "统率",
    "speed": "速度",
    "skill": "特技",
    "effect": "特效",
}


ASSET_ATTR_TERMS = {
    "equipment": {
        "skill": (
            "无双",
            "武圣",
            "仁德",
            "奸雄",
            "风华",
            "叠羽",
            "枭姬",
            "勤学",
            "远虑",
            "磐石",
            "黄天",
            "浴血",
            "完璧",
            "天机",
            "诡谋",
            "仙术",
            "谋定",
            "意志",
            "无畏",
            "集智",
            "先御",
            "夺志",
            "神射",
            "护卫",
            "扶危",
            "神威",
            "藏锋",
            "静心",
            "援救",
            "诡术",
            "非攻",
        ),
        "effect": (
            "打磨",
            "灵光",
            "决机",
            "穷堵",
            "克己",
            "守心",
            "断虹",
            "神锋",
            "愈合",
            "坚甲",
            "铁壁",
            "肃静",
            "镇定",
            "不屈",
            "励军",
            "守拙",
            "荡寇",
            "摧城",
            "破虏",
        ),
    },
    "horse": {
        "skill": (
            "破胆",
            "龙佑",
            "腾霄",
            "算略",
            "铁骑",
            "骁果",
            "燕颔",
            "君临",
            "游龙",
            "万象",
            "渡火",
            "疾驰",
            "奔袭",
            "穿云",
            "嘶风",
            "掠水",
            "救主",
        ),
        "effect": (
            "狂意",
            "流火",
            "赤焰",
            "惊弦",
            "傲骨",
            "掣电",
            "擎电",
            "困龙",
            "照影",
            "锐目",
            "聪慧",
            "神速",
            "灵心",
            "碎岩",
            "灵巧",
            "荡寇",
            "摧城",
            "破虏",
        ),
    },
}


def _merge_asset_terms(asset_kind: str, attr_key: str, values: dict[str, str]) -> None:
    if not values:
        return
    terms_by_key = ASSET_ATTR_TERMS.setdefault(asset_kind, {})
    existing = list(terms_by_key.get(attr_key, ()))
    for name in values.values():
        if name and name not in existing:
            existing.append(name)
    terms_by_key[attr_key] = tuple(existing)


_merge_asset_terms("equipment", "skill", AUTHORITATIVE_EQUIPMENT_SKILL_NAMES)
_merge_asset_terms("equipment", "effect", AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES)
_merge_asset_terms("horse", "skill", AUTHORITATIVE_HORSE_SKILL_NAMES)
_merge_asset_terms("horse", "effect", AUTHORITATIVE_HORSE_EFFECT_NAMES)


ASSET_ATTR_FALLBACK_NAMES = {
    "equipment:skill:6": "谋定",
    "equipment:skill:7": "神威",
    "equipment:skill:8": "夺志",
    "equipment:skill:9": "神射",
    "equipment:skill:10": "藏锋",
    "equipment:skill:11": "扶危",
    "equipment:skill:12": "先御",
    "equipment:skill:13": "护卫",
    "equipment:skill:14": "意志",
    "equipment:skill:15": "无畏",
    "equipment:skill:16": "集智",
    "equipment:skill:17": "静心",
    "equipment:skill:18": "援救",
    "equipment:skill:19": "诡术",
    "equipment:skill:20": "非攻",
    "equipment:skill:26": "先御",
    "equipment:skill:27": "护卫",
    "equipment:skill:29": "无畏",
    "equipment:skill:1000": "无双",
    "equipment:skill:1001": "仁德",
    "equipment:skill:1002": "武圣",
    "equipment:skill:1003": "风华",
    "equipment:skill:1004": "奸雄",
    "equipment:skill:1005": "远虑",
    "equipment:skill:1006": "磐石",
    "equipment:skill:1007": "完璧",
    "equipment:skill:1008": "天机",
    "equipment:skill:1009": "诡谋",
    "equipment:skill:1010": "勤学",
    "equipment:skill:1013": "黄天",
    "equipment:skill:1014": "仙术",
    "equipment:skill:1015": "枭姬",
    "equipment:effect:1": "打磨",
    "equipment:effect:2": "断虹",
    "equipment:effect:3": "神锋",
    "equipment:effect:4": "决机",
    "equipment:effect:5": "穷堵",
    "equipment:effect:6": "愈合",
    "equipment:effect:7": "坚甲",
    "equipment:effect:8": "铁壁",
    "equipment:effect:9": "肃静",
    "equipment:effect:10": "镇定",
    "equipment:effect:11": "不屈",
    "equipment:effect:12": "灵光",
    "equipment:effect:13": "励军",
    "equipment:effect:14": "守拙",
    "equipment:effect:15": "克己",
    "equipment:effect:16": "守心",
    "equipment:effect:17": "荡寇",
    "equipment:effect:18": "断虹",
    "equipment:effect:19": "神锋",
    "equipment:effect:21": "穷堵",
    "equipment:effect:24": "铁壁",
    "equipment:effect:29": "励军",
    "equipment:effect:30": "守拙",
    "equipment:effect:32": "守心",
    "equipment:effect:35": "神锋",
    "equipment:effect:36": "决机",
    "equipment:effect:38": "愈合",
    "equipment:effect:39": "坚甲",
    "equipment:effect:40": "铁壁",
    "equipment:effect:41": "肃静",
    "equipment:effect:42": "镇定",
    "equipment:effect:44": "灵光",
    "equipment:effect:45": "励军",
    "equipment:effect:48": "守心",
    "equipment:effect:68": "守拙",
    "horse:skill:49": "万象",
    "horse:skill:50": "游龙",
    "horse:skill:51": "疾驰",
    "horse:skill:52": "奔袭",
    "horse:skill:53": "穿云",
    "horse:skill:54": "嘶风",
    "horse:skill:55": "掠水",
    "horse:skill:56": "救主",
    "horse:skill:57": "君临",
    "horse:skill:58": "渡火",
    "horse:skill:304": "破胆",
    "horse:skill:305": "龙佑",
    "horse:skill:306": "腾霄",
    "horse:skill:307": "算略",
    "horse:skill:308": "骁果",
    "horse:skill:309": "铁骑",
    "horse:skill:3004": "破胆",
    "horse:skill:3005": "龙佑",
    "horse:skill:3006": "腾霄",
    "horse:skill:3007": "算略",
    "horse:skill:3008": "骁果",
    "horse:skill:3009": "铁骑",
    "horse:effect:49": "聪慧",
    "horse:effect:50": "神速",
    "horse:effect:51": "灵心",
    "horse:effect:52": "碎岩",
    "horse:effect:53": "锐目",
    "horse:effect:54": "照影",
    "horse:effect:55": "灵巧",
    "horse:effect:56": "赤焰",
    "horse:effect:57": "惊弦",
    "horse:effect:58": "傲骨",
    "horse:effect:59": "掣电",
    "horse:effect:60": "流火",
    "horse:effect:61": "狂意",
    "horse:effect:62": "困龙",
    "horse:effect:66": "荡寇",
    "horse:effect:70": "摧城",
    "horse:effect:74": "破虏",
}


TAG_PATTERN = re.compile(r"<[^>]+>")
BRACKET_NAME_PATTERN = re.compile(r"\[([^\[\]]+)\]")
FORMATION_PATTERN = re.compile(r"阵型[——-]+([^】\]]+)")
EQUIPMENT_PATTERN = re.compile(r"执行【装备-([^】]+)】效果")
HORSE_PATTERN = re.compile(r"执行【马匹-([^】]+)】效果")
WARBOOK_PATTERN = re.compile(r"获得战法【([^】]+)】")
SKILL_PATTERNS = (
    re.compile(r"发动战法【([^】]+)】"),
    re.compile(r"执行来自【([^】]+)】"),
    re.compile(r"由于.*?【([^】]+)】"),
)
TROOP_PATTERN = re.compile(r"兵种加成-([^」】\s]+)")
ASSET_EFFECT_PATTERN = re.compile(r"的【([^】]+)】")
ASSET_SOURCE_PATTERNS = (
    re.compile(r"的「([^」]+)」效果已施加"),
    re.compile(r"执行来自「([^」]+)」效果"),
)


@dataclass
class BattleNameIndex:
    hero_names: dict[str, str]
    skill_names: dict[str, str]
    formation_names: dict[str, str]
    troop_names: dict[str, str]
    warbook_names: dict[str, str]
    equipment_names: dict[str, str]
    horse_names: dict[str, str]
    asset_attr_names: dict[str, dict[str, list[str]]]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _format_id(value: Any) -> str:
    parsed = _to_int(value)
    if parsed is not None:
        return str(parsed)
    return _as_str(value)


def _append_unique(target: list[str], value: str) -> None:
    text = _as_str(value)
    if text and text not in target:
        target.append(text)


def _compact_name_list(values: list[str] | None) -> str:
    if not values:
        return ""
    unique: list[str] = []
    for value in values:
        _append_unique(unique, value)
    return " / ".join(unique)


def _clean_event_text(value: Any) -> str:
    return TAG_PATTERN.sub("", _as_str(value)).strip()


def _first_match(pattern: re.Pattern[str], text: str) -> str:
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def _event_int_list(raw_event: dict[str, Any]) -> list[Any]:
    values = raw_event.get("intList")
    return values if isinstance(values, list) else []


def _name_key(team_id: Any, hero_id: Any) -> str:
    team_text = _format_id(team_id)
    hero_text = _format_id(hero_id)
    return f"{team_text}:{hero_text}" if team_text and hero_text else ""


def _asset_key(kind: str, team_id: Any, hero_id: Any, item_id: Any) -> str:
    owner_key = _name_key(team_id, hero_id)
    item_text = _format_id(item_id)
    return f"{kind}:{owner_key}:{item_text}" if owner_key and item_text else ""


def _lookup_asset_attr_names(
    name_index: BattleNameIndex,
    kind: str,
    team_id: Any,
    hero_id: Any,
    item_id: Any,
) -> dict[str, list[str]]:
    key = _asset_key(kind, team_id, hero_id, item_id)
    return name_index.asset_attr_names.get(key, {}) if key else {}


def _asset_attr_display_name(
    asset_kind: str,
    attr_key: str,
    value_id: str,
    names: list[str] | None,
) -> str:
    authoritative_name = _authoritative_asset_attr_name(asset_kind, attr_key, value_id)
    if authoritative_name:
        return authoritative_name
    fallback_name = ASSET_ATTR_FALLBACK_NAMES.get(f"{asset_kind}:{attr_key}:{value_id}", "")
    known_names = [
        name
        for name in (names or [])
        if _asset_attr_key_for_name(asset_kind, name) == attr_key
    ]
    if known_names:
        return _compact_name_list(known_names)
    if fallback_name:
        return fallback_name
    return _compact_name_list(names)


def _attrs_from_list(
    items: Any,
    attr_names: dict[str, list[str]] | None = None,
    asset_kind: str = "",
) -> list[dict[str, Any]]:
    attrs: list[dict[str, Any]] = []
    for item in _as_list(items):
        record = _as_dict(item)
        key = _as_str(record.get("key"))
        if not key:
            continue
        names = attr_names.get(key, []) if attr_names else []
        raw_value = record.get("val", "")
        value_id = _format_id(raw_value)
        attrs.append(
            {
                "key": key,
                "label": ATTR_LABELS.get(key, key),
                "value": raw_value,
                "name": _asset_attr_display_name(asset_kind, key, value_id, names),
            }
        )
    return attrs


def _decoded_path_from_source(source_value: Any) -> Path | None:
    source_text = _as_str(source_value)
    if not source_text:
        return None

    source = Path(source_text)
    if not source.is_absolute():
        source = ROOT / source
    if not source.exists():
        return None

    parent = source.parent
    name = source.name
    if name.endswith(".decoded.json"):
        return source

    for suffix in (
        "_eventDataList.events.json",
        "_eventDataList.parsed_events.json",
        ".parsed_events.json",
        ".events.json",
    ):
        if name.endswith(suffix):
            decoded = parent / f"{name[: -len(suffix)]}.decoded.json"
            if decoded.exists():
                return decoded

    candidates = sorted(parent.glob("*.decoded.json"))
    if candidates:
        return candidates[0]

    return None


def _raw_events_path_from_decoded(decoded_path: Path) -> Path | None:
    name = decoded_path.name
    parent = decoded_path.parent
    if name.endswith(".decoded.json"):
        candidate = parent / f"{name[: -len('.decoded.json')]}_eventDataList.events.json"
        if candidate.exists():
            return candidate

    candidates = sorted(parent.glob("*_eventDataList.events.json"))
    return candidates[0] if candidates else None


def _load_raw_events(decoded_path: Path) -> list[dict[str, Any]]:
    path = _raw_events_path_from_decoded(decoded_path)
    if path is None:
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [item for item in _as_list(payload) if isinstance(item, dict)]


def _event_value(record: dict[str, Any], raw_values: list[Any], key: str, position: int) -> Any:
    value = record.get(key)
    if value not in (None, ""):
        return value
    return raw_values[position] if len(raw_values) > position else ""


def _record_hero_name(
    index: BattleNameIndex,
    team_id: Any,
    hero_id: Any,
    text: str,
) -> None:
    key = _name_key(team_id, hero_id)
    if not key:
        return
    name = _first_match(BRACKET_NAME_PATTERN, text)
    if name:
        index.hero_names.setdefault(key, name)


def _record_asset_attr_name(
    index: BattleNameIndex,
    asset: tuple[str, Any, Any, Any],
    attr_key: str,
    name: str,
) -> None:
    kind, team_id, hero_id, item_id = asset
    key = _asset_key(kind, team_id, hero_id, item_id)
    if not key:
        return
    bucket = index.asset_attr_names.setdefault(key, {})
    names = bucket.setdefault(attr_key, [])
    _append_unique(names, name)


def _asset_attr_key_for_name(asset_kind: str, name: str) -> str:
    text = _as_str(name)
    terms_by_key = ASSET_ATTR_TERMS.get(asset_kind, {})
    for attr_key, terms in terms_by_key.items():
        if text in terms:
            return attr_key
    return ""


def _record_asset_terms_from_text(
    index: BattleNameIndex,
    asset: tuple[str, Any, Any, Any],
    text: str,
) -> None:
    asset_kind = asset[0]
    terms_by_key = ASSET_ATTR_TERMS.get(asset_kind, {})
    if not terms_by_key:
        return
    for attr_key, terms in terms_by_key.items():
        for term in terms:
            if f"【{term}】" in text:
                _record_asset_attr_name(index, asset, attr_key, term)


def _record_skill_name(index: BattleNameIndex, skill_id: Any, skill_name: str) -> None:
    key = _format_id(skill_id)
    if not key or key.startswith("-"):
        return
    name = _as_str(skill_name)
    if name:
        index.skill_names.setdefault(key, name)


def _build_battle_name_index(payload: dict[str, Any], decoded_path: Path) -> BattleNameIndex:
    index = BattleNameIndex(
        hero_names={},
        skill_names={},
        formation_names=dict(AUTHORITATIVE_FORMATION_NAMES),
        troop_names={},
        warbook_names={},
        equipment_names={},
        horse_names={},
        asset_attr_names={},
    )
    events = [item for item in _as_list(payload.get("events")) if isinstance(item, dict)]
    raw_events = _load_raw_events(decoded_path)
    active_asset: tuple[str, Any, Any, Any] | None = None

    for position, event in enumerate(events):
        record = _as_dict(event)
        raw_event = raw_events[position] if position < len(raw_events) else {}
        raw_values = _event_int_list(raw_event)
        event_id = _to_int(record.get("eventId")) or _to_int(raw_event.get("eventId")) or 0
        team_id = _event_value(record, raw_values, "teamId", 0)
        hero_id = _event_value(record, raw_values, "heroId", 1)
        text = _clean_event_text(record.get("description"))

        _record_hero_name(index, team_id, hero_id, text)

        skill_id = _format_id(record.get("skillId"))
        skill_name = _as_str(record.get("skillName"))
        if skill_name:
            _record_skill_name(index, skill_id, skill_name)
        elif skill_id:
            for pattern in SKILL_PATTERNS:
                name = _first_match(pattern, text)
                if name:
                    _record_skill_name(index, skill_id, name)
                    break

        buff_name = _as_str(record.get("buffName"))
        troop_name = _first_match(TROOP_PATTERN, buff_name) or _first_match(TROOP_PATTERN, text)
        if troop_name:
            hero_key = _name_key(team_id, hero_id)
            if hero_key:
                index.troop_names.setdefault(hero_key, troop_name)

        if event_id == 52:
            formation_id = raw_values[1] if len(raw_values) > 1 else record.get("formationId")
            formation_name = _first_match(FORMATION_PATTERN, text)
            formation_key = _format_id(formation_id)
            if formation_key and formation_name:
                index.formation_names.setdefault(formation_key, formation_name)
            active_asset = None
            continue

        if event_id == 60:
            warbook_id = raw_values[2] if len(raw_values) > 2 else record.get("warbookId")
            warbook_name = _first_match(WARBOOK_PATTERN, text)
            warbook_key = _format_id(warbook_id)
            if warbook_key and warbook_name:
                index.warbook_names.setdefault(warbook_key, warbook_name)
            active_asset = None
            continue

        if event_id in (63, 67):
            item_id = raw_values[2] if len(raw_values) > 2 else ""
            item_key = _format_id(item_id)
            if event_id == 63:
                name = _first_match(EQUIPMENT_PATTERN, text)
                if item_key and name:
                    index.equipment_names.setdefault(item_key, name)
                active_asset = ("equipment", team_id, hero_id, item_id)
            else:
                name = _first_match(HORSE_PATTERN, text)
                if item_key and name:
                    index.horse_names.setdefault(item_key, name)
                active_asset = ("horse", team_id, hero_id, item_id)
            continue

        if active_asset is None:
            continue

        asset_kind, asset_team_id, asset_hero_id, _asset_item_id = active_asset
        if _name_key(asset_team_id, asset_hero_id) != _name_key(team_id, hero_id):
            active_asset = None
            continue

        if event_id not in (209, 210, 211, 213, 214, 247, 248, 252, 259):
            active_asset = None
            continue

        if buff_name and "兵种加成-" not in buff_name:
            attr_key = _asset_attr_key_for_name(asset_kind, buff_name) or "skill"
            _record_asset_attr_name(index, active_asset, attr_key, buff_name)

        for pattern in ASSET_SOURCE_PATTERNS:
            source_name = _first_match(pattern, text)
            if source_name:
                attr_key = _asset_attr_key_for_name(asset_kind, source_name) or "skill"
                _record_asset_attr_name(index, active_asset, attr_key, source_name)

        for effect_name in ASSET_EFFECT_PATTERN.findall(text):
            if effect_name and effect_name != buff_name:
                _record_asset_attr_name(index, active_asset, "effect", effect_name)

        _record_asset_terms_from_text(index, active_asset, text)

        if asset_kind not in ("equipment", "horse"):
            active_asset = None

    return index


def _find_combat_info(payload: Any, depth: int = 0) -> dict[str, Any]:
    if depth > 4:
        return {}
    record = _as_dict(payload)
    combat_info = record.get("combatInfo")
    if isinstance(combat_info, dict):
        return combat_info
    for value in record.values():
        if isinstance(value, dict):
            found = _find_combat_info(value, depth + 1)
            if found:
                return found
    return {}


def _build_skill_detail(skill: Any, name_index: BattleNameIndex) -> dict[str, Any]:
    record = _as_dict(skill)
    skill_id = _format_id(record.get("skillId"))
    return {
        "skillId": skill_id,
        "name": _authoritative_term(AUTHORITATIVE_SKILL_NAMES, skill_id)
        or name_index.skill_names.get(skill_id, ""),
        "level": _to_int(record.get("level")),
        "orderLevel": _to_int(record.get("orderLevel")),
        "position": _to_int(record.get("position")),
        "showReplace": bool(record.get("showReplace", False)),
    }


def _build_warbook_detail(warbook_id: Any, name_index: BattleNameIndex) -> dict[str, Any]:
    formatted_id = _format_id(warbook_id)
    return {
        "warbookId": formatted_id,
        "name": _authoritative_term(AUTHORITATIVE_WARBOOK_NAMES, formatted_id)
        or name_index.warbook_names.get(formatted_id, ""),
    }


def _build_hero_detail(member: Any, team_id: Any, name_index: BattleNameIndex) -> dict[str, Any]:
    record = _as_dict(member)
    hero_id = _format_id(record.get("heros_id") or record.get("heroId"))
    hero_key = _name_key(team_id, hero_id)
    hero_name = _alliance_hero_name(hero_id, record.get("name") or name_index.hero_names.get(hero_key, ""))
    skills = [
        _build_skill_detail(skill, name_index)
        for skill in _as_list(record.get("skills"))[:3]
        if isinstance(skill, dict)
    ]
    warbooks = _as_dict(record.get("warbooks"))
    warbook_ids = _as_list(warbooks.get("idList"))
    warbook_details = [_build_warbook_detail(warbook_id, name_index) for warbook_id in warbook_ids]
    equip_id = _format_id(record.get("equipId"))
    horse_id = _format_id(record.get("horseId"))
    equipment_attr_names = _lookup_asset_attr_names(name_index, "equipment", team_id, hero_id, equip_id)
    horse_attr_names = _lookup_asset_attr_names(name_index, "horse", team_id, hero_id, horse_id)

    return {
        "heroId": hero_id,
        "name": hero_name,
        "displayName": _alliance_hero_display_name(hero_id, hero_name),
        "position": _to_int(record.get("index")),
        "group": _to_int(record.get("group")),
        "basicArmsId": _to_int(record.get("basicArmsId")),
        "level": _to_int(record.get("hero_lv") or record.get("level")),
        "evolution": _to_int(record.get("evolutionNum")),
        "enlighten": _to_int(record.get("enlighten")),
        "originTroops": _to_int(record.get("origin_troop_num")),
        "armyTroops": _to_int(record.get("army_troop_num")),
        "remainingTroops": _to_int(record.get("troop_num")),
        "dead": _to_int(record.get("dead_num")),
        "wounded": _to_int(record.get("wound_num")),
        "skills": skills,
        "warbooks": warbook_details,
        "warbookItemId": _format_id(warbooks.get("itemId")),
        "equipment": {
            "equipId": equip_id,
            "name": _authoritative_term(AUTHORITATIVE_EQUIPMENT_NAMES, equip_id)
            or name_index.equipment_names.get(equip_id, ""),
            "attrs": _attrs_from_list(record.get("equipData"), equipment_attr_names, "equipment"),
        },
        "horse": {
            "horseId": horse_id,
            "name": _authoritative_term(AUTHORITATIVE_HORSE_NAMES, horse_id)
            or name_index.horse_names.get(horse_id, ""),
            "attrs": _attrs_from_list(record.get("horseData"), horse_attr_names, "horse"),
        },
        "basicArmsName": name_index.troop_names.get(hero_key, ""),
    }


def _team_totals(heroes: list[dict[str, Any]]) -> dict[str, int]:
    keys = ("originTroops", "remainingTroops", "dead", "wounded")
    totals: dict[str, int] = {key: 0 for key in keys}
    for hero in heroes:
        for key in keys:
            value = _to_int(hero.get(key))
            if value is not None:
                totals[key] += value
    return totals


def _build_team_detail(
    side: str,
    label: str,
    team: Any,
    winner_army_id: str,
    name_index: BattleNameIndex,
) -> dict[str, Any]:
    record = _as_dict(team)
    avatar = _as_dict(record.get("avatar_data"))
    army_id = _format_id(record.get("army_id"))
    formation_id = _format_id(record.get("formationId"))
    heroes = [
        _build_hero_detail(member, army_id, name_index)
        for member in _as_list(record.get("army_member"))
        if isinstance(member, dict)
    ]
    return {
        "side": side,
        "label": label,
        "armyId": army_id,
        "winner": bool(winner_army_id and army_id == winner_army_id),
        "leaderHeroId": _format_id(record.get("army_leader_id")),
        "player": {
            "avatarId": _format_id(avatar.get("avatar_id")),
            "name": _as_str(avatar.get("avatar_name")),
            "allianceId": _format_id(avatar.get("avatar_union_id")),
            "allianceName": _as_str(avatar.get("avatar_union_name")),
            "faction": _to_int(avatar.get("faction")),
            "bornStateId": _to_int(avatar.get("bornStateId")),
        },
        "formationId": formation_id,
        "formationName": name_index.formation_names.get(formation_id, "") or _formation_name(formation_id),
        "morale": _to_int(record.get("morale")),
        "originZgNum": _to_int(record.get("originZgNum")),
        "zgNum": _to_int(record.get("zgNum")),
        "totalTroopNum": _to_int(record.get("totalTroopNum")),
        "nowTroopNum": _to_int(record.get("nowTroopNum")),
        "heroes": heroes,
        "totals": _team_totals(heroes),
    }


def build_battle_details(payload: dict[str, Any]) -> dict[str, Any]:
    decoded_path = _decoded_path_from_source(payload.get("source"))
    if decoded_path is None:
        return {}

    try:
        decoded = json.loads(decoded_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    decoded_record = _as_dict(decoded)
    combat_info = _find_combat_info(decoded_record)
    settlement = _as_dict(combat_info.get("battleSettlement"))
    if not settlement:
        return {}

    winner_army_id = _format_id(settlement.get("winer") or settlement.get("winner"))
    name_index = _build_battle_name_index(payload, decoded_path)
    details = {
        "schema": "battle-details-v2",
        "source": str(decoded_path),
        "battleId": _format_id(combat_info.get("battleID") or decoded_record.get("battleID")),
        "matchType": _to_int(combat_info.get("matchType")),
        "combatType": _to_int(combat_info.get("combatType")),
        "scenarioId": _to_int(combat_info.get("scenarioId")),
        "endRound": _to_int(combat_info.get("endRound")),
        "winnerArmyId": winner_army_id,
        "location": _as_list(combat_info.get("locationOccur")),
        "attacker": _build_team_detail(
            "attacker",
            "攻方",
            settlement.get("attacker"),
            winner_army_id,
            name_index,
        ),
        "defender": _build_team_detail(
            "defender",
            "守方",
            settlement.get("defensive"),
            winner_army_id,
            name_index,
        ),
    }
    return details


def enrich_report_payload(json_path: Path | None, payload: dict[str, Any]) -> dict[str, Any]:
    if not payload:
        return payload

    existing_details = _as_dict(payload.get("battleDetails"))
    if existing_details.get("schema") == "battle-details-v2":
        return payload

    details = build_battle_details(payload)
    if not details:
        return payload

    payload["battleDetails"] = details
    if json_path is not None:
        try:
            json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            emit_log(f"Failed to write enriched report JSON: {exc}", "warning")
    return payload


def _report_export_stem(path: Path) -> str:
    stem = path.stem
    if stem.endswith(".readable"):
        stem = stem[: -len(".readable")]
    return stem


def _report_export_paths(primary_path: Path | None) -> tuple[Path | None, Path | None]:
    if primary_path is None:
        return None, None
    stem = _report_export_stem(primary_path)
    return primary_path.with_name(f"{stem}.battle.json"), primary_path.with_name(f"{stem}.battle.md")


def _clean_md_value(value: Any, fallback: str = "-") -> str:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = _as_str(value)
    return text if text else fallback


def _hero_red_label(value: Any) -> str:
    parsed = _to_int(value)
    return f"红{parsed}" if parsed is not None else ""


def _troop_summary_text(totals: dict[str, Any]) -> str:
    origin = _num_or_zero(totals.get("originTroops"))
    remaining = _num_or_zero(totals.get("remainingTroops"))
    wounded = _num_or_zero(totals.get("wounded"))
    dead = _num_or_zero(totals.get("dead"))
    if origin <= 0 and remaining <= 0 and wounded <= 0 and dead <= 0:
        return "-"
    return f"{remaining}/{origin}，伤兵 {wounded}，阵亡 {dead}"


def _skill_md_label(skill: Any) -> str:
    record = _as_dict(skill)
    skill_id = _format_id(record.get("skillId"))
    # S17 起游戏事件里新技能的 name 常为空串（21050 保境安民、1252 怀锋献策等），
    # 词表已收录 → 用索引兜底，否则文本战报会输出「战法 #21050」这种给机器看的 ID。
    name = (
        _as_str(record.get("name"))
        or _authoritative_term(AUTHORITATIVE_SKILL_NAMES, skill_id)
        or (f"战法 #{skill_id}" if skill_id else "未知战法")
    )
    meta = [
        f"Lv.{level}" if (level := _to_int(record.get("level"))) is not None else "",
        f"品 {order}" if (order := _to_int(record.get("orderLevel"))) is not None else "",
        f"槽位 {position}" if (position := _to_int(record.get("position"))) is not None and position > 0 else "",
    ]
    meta_text = " / ".join(item for item in meta if item)
    return f"{name} ({meta_text})" if meta_text else name


def _warbook_md_label(warbook: Any) -> str:
    record = _as_dict(warbook)
    name = _as_str(record.get("name"))
    warbook_id = _format_id(record.get("warbookId"))
    # 同 _skill_md_label：S17 新增战法的 name 可能为空，先用词表兜底再退化到 ID。
    return (
        name
        or _authoritative_term(AUTHORITATIVE_WARBOOK_NAMES, warbook_id)
        or (f"韬略 #{warbook_id}" if warbook_id else "")
    )


# 装备/马匹「特效/特技」记录在 name 为空时用词表兜底；键为 (kind, attrKey)。
_ASSET_ATTR_TERM_MAPS: dict[tuple[str, str], dict[str, str]] = {
    ("装备", "skill"): AUTHORITATIVE_EQUIPMENT_SKILL_NAMES,
    ("装备", "effect"): AUTHORITATIVE_EQUIPMENT_EFFECT_NAMES,
    ("马匹", "skill"): AUTHORITATIVE_HORSE_SKILL_NAMES,
    ("马匹", "effect"): AUTHORITATIVE_HORSE_EFFECT_NAMES,
}

# 装备/马匹本体名称的兜底词表（S17 起部分记录 name 为空）。
_ASSET_TERM_MAPS: dict[str, dict[str, str]] = {
    "装备": AUTHORITATIVE_EQUIPMENT_NAMES,
    "马匹": AUTHORITATIVE_HORSE_NAMES,
}


def _asset_attr_md_label(attr: Any, kind: str = "") -> str:
    record = _as_dict(attr)
    key = _as_str(record.get("key"))
    if key in {"might", "intelligence", "defence", "defense", "speed"}:
        return ""
    label = _as_str(record.get("label")) or key
    value = _format_id(record.get("value"))
    # 词表兜底：S17 实测特效/特技的 name 也可能为空
    name = _as_str(record.get("name")) or _authoritative_term(
        _ASSET_ATTR_TERM_MAPS.get((kind, key), {}), value
    )
    if name:
        return f"{label}: {name}" if label else name
    if key in {"skill", "effect"}:
        return ""
    return f"{label}: {value}" if label and value else label or value


def _asset_md_label(kind: str, asset: Any, id_key: str) -> str:
    record = _as_dict(asset)
    asset_id = _format_id(record.get(id_key))
    # 词表兜底：本体 name 为空时用词表（否则输出「装备 #2000041」）
    name = _as_str(record.get("name")) or _authoritative_term(
        _ASSET_TERM_MAPS.get(kind, {}), asset_id
    )
    head = f"{kind} {name}{f' (#{asset_id})' if asset_id else ''}" if name else (
        f"{kind} #{asset_id}" if asset_id else ""
    )
    attrs = [
        item
        for item in (_asset_attr_md_label(attr, kind) for attr in _as_list(record.get("attrs")))
        if item
    ]
    return " · ".join(item for item in [head, " / ".join(attrs)] if item)


def _team_title(team: dict[str, Any], fallback: str) -> str:
    player = _as_dict(team.get("player"))
    player_name = _as_str(player.get("name")) or (
        f"玩家 #{_format_id(player.get('avatarId'))}" if _format_id(player.get("avatarId")) else "未知玩家"
    )
    alliance_name = _as_str(player.get("allianceName"))
    formation = _as_str(team.get("formationName")) or (
        f"阵型 #{_format_id(team.get('formationId'))}" if _format_id(team.get("formationId")) else ""
    )
    title = f"{_as_str(team.get('label')) or fallback}: {player_name}"
    if alliance_name:
        title += f" / {alliance_name}"
    if formation:
        title += f" / {formation}"
    if bool(team.get("winner")):
        title += " / 胜"
    return title


def _hero_md_line(hero: dict[str, Any]) -> str:
    hero_id = _format_id(hero.get("heroId"))
    name = _alliance_hero_display_name(
        hero_id,
        _alliance_hero_name(hero_id, hero.get("displayName") or hero.get("name")),
    )
    meta = [
        _hero_red_label(hero.get("evolution")),
        f"Lv.{level}" if (level := _to_int(hero.get("level"))) is not None else "",
        f"兵种 {_as_str(hero.get('basicArmsName'))}" if _as_str(hero.get("basicArmsName")) else "",
    ]
    troop_text = _troop_summary_text(
        {
            "originTroops": hero.get("originTroops") or hero.get("armyTroops"),
            "remainingTroops": hero.get("remainingTroops"),
            "wounded": hero.get("wounded"),
            "dead": hero.get("dead"),
        }
    )
    skills = "；".join(_skill_md_label(skill) for skill in _as_list(hero.get("skills"))[:3])
    warbooks = "；".join(
        item for item in (_warbook_md_label(warbook) for warbook in _as_list(hero.get("warbooks"))) if item
    )
    equipment = _asset_md_label("装备", hero.get("equipment"), "equipId")
    horse = _asset_md_label("马匹", hero.get("horse"), "horseId")
    details = [
        " / ".join(item for item in meta if item),
        f"兵力 {troop_text}" if troop_text != "-" else "",
        f"战法: {skills}" if skills else "",
        f"韬略: {warbooks}" if warbooks else "",
        equipment,
        horse,
    ]
    detail_text = "；".join(item for item in details if item)
    return f"- {name}: {detail_text}" if detail_text else f"- {name}"


def _append_team_markdown(lines: list[str], team: dict[str, Any], fallback: str) -> None:
    lines.append(f"### {_team_title(team, fallback)}")
    lines.append("")
    totals = _as_dict(team.get("totals"))
    lines.append(f"- 部队: {_clean_md_value(team.get('armyId'))}")
    lines.append(f"- 兵力: {_troop_summary_text(totals)}")
    morale = _to_int(team.get("morale"))
    zg_num = _to_int(team.get("zgNum"))
    if morale is not None or zg_num is not None:
        lines.append(f"- 士气/统御: {_clean_md_value(morale)} / {_clean_md_value(zg_num)}")
    heroes = [
        _as_dict(hero)
        for hero in _as_list(team.get("heroes"))
        if isinstance(hero, dict)
    ]
    if heroes:
        lines.append("")
        lines.append("武将:")
        for hero in sorted(heroes, key=lambda item: _to_int(item.get("position")) or 99):
            lines.append(_hero_md_line(hero))
    lines.append("")


def _event_md_line(event: Any, index: int) -> str:
    record = _as_dict(event)
    seq = _to_int(record.get("seq")) or index + 1
    round_value = _to_int(record.get("round"))
    event_id = _to_int(record.get("eventId")) or 0
    description = _first_text_value(record.get("description"), record.get("rawText"), record.get("raw"))
    prefix = f"[{seq:04d} e{event_id}"
    if round_value is not None:
        prefix += f" r{round_value}"
    prefix += "]"
    return f"- {prefix} {description}" if description else f"- {prefix}"


def build_ai_battle_markdown(
    *,
    session_id: str,
    report_id: str,
    payload: dict[str, Any],
    battle_json_path: Path | None,
) -> str:
    summary = _as_dict(payload.get("summary"))
    details = _as_dict(payload.get("battleDetails"))
    events = _as_list(payload.get("events"))
    lines: list[str] = [
        "# 战报 AI 阅读版",
        "",
        "## 元信息",
        "",
        f"- 报告: {_clean_md_value(report_id)}",
        f"- 会话: {_clean_md_value(session_id)}",
        f"- 生成时间: {now_iso()}",
    ]
    if battle_json_path is not None:
        lines.append(f"- 完整 JSON: `{battle_json_path}`")
    source = _as_str(payload.get("source"))
    if source:
        lines.append(f"- 原始来源: `{source}`")
    lines.append("")

    lines.extend(
        [
            "## 摘要",
            "",
            f"- 事件数: {_clean_md_value(summary.get('event_count') or payload.get('event_count'))}",
            f"- 回合数: {_clean_md_value(summary.get('round_count') or details.get('endRound'))}",
            f"- 伤害事件: {_clean_md_value(summary.get('damage_events'))}",
            f"- 治疗事件: {_clean_md_value(summary.get('heal_events'))}",
        ]
    )
    if details:
        lines.extend(
            [
                f"- 战斗 ID: {_clean_md_value(details.get('battleId'))}",
                f"- 胜方部队: {_clean_md_value(details.get('winnerArmyId'))}",
            ]
        )
    lines.append("")

    attacker = _as_dict(details.get("attacker"))
    defender = _as_dict(details.get("defender"))
    if attacker or defender:
        lines.append("## 双方阵容")
        lines.append("")
        if attacker:
            _append_team_markdown(lines, attacker, "攻方")
        if defender:
            _append_team_markdown(lines, defender, "守方")

    top_skills = _as_list(summary.get("top_skills"))
    if top_skills:
        lines.append("## 高频战法/事件")
        lines.append("")
        for item in top_skills[:12]:
            if isinstance(item, list) and len(item) >= 2:
                lines.append(f"- {_clean_md_value(item[0])}: {_clean_md_value(item[1])}")
        lines.append("")

    if events:
        lines.append("## 事件流水")
        lines.append("")
        lines.append("以下保留前 300 条事件，完整结构请读取同目录 `.battle.json`。")
        lines.append("")
        for index, event in enumerate(events[:300]):
            lines.append(_event_md_line(event, index))
        if len(events) > 300:
            lines.append(f"- ... 其余 {len(events) - 300} 条见 battle.json")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_ai_battle_payload(
    *,
    session_id: str,
    report_id: str,
    payload: dict[str, Any],
    paths: dict[str, str],
) -> dict[str, Any]:
    return {
        "schema": "battle-report-ai-v1",
        "generatedAt": now_iso(),
        "sessionId": session_id,
        "id": report_id,
        "paths": paths,
        "summary": _as_dict(payload.get("summary")),
        "battleDetails": _as_dict(payload.get("battleDetails")),
        "events": _as_list(payload.get("events")),
        "rawPayload": payload,
    }


def append_structured_details_to_rendered_files(
    md_path: Path | None,
    html_path: Path | None,
    markdown_text: str,
) -> None:
    if not markdown_text.strip():
        return

    section = (
        f"\n\n{STRUCTURED_MARKER_START}\n"
        "## 结构化战报详情\n\n"
        f"{markdown_text.strip()}\n"
        f"{STRUCTURED_MARKER_END}\n"
    )
    if md_path is not None and md_path.exists():
        try:
            content = md_path.read_text(encoding="utf-8")
            if STRUCTURED_MARKER_START not in content:
                md_path.write_text(content.rstrip() + section, encoding="utf-8")
        except Exception as exc:
            emit_log(f"Failed to append structured markdown details: {exc}", "warning")

    if html_path is not None and html_path.exists():
        try:
            content = html_path.read_text(encoding="utf-8")
            if STRUCTURED_MARKER_START in content:
                return
            escaped = html.escape(markdown_text.strip())
            html_section = (
                f"\n{STRUCTURED_MARKER_START}\n"
                "<section style=\"border-top:1px solid #444;margin-top:24px;padding-top:16px\">"
                "<h2>结构化战报详情</h2>"
                f"<pre style=\"white-space:pre-wrap;line-height:1.7\">{escaped}</pre>"
                "</section>\n"
                f"{STRUCTURED_MARKER_END}\n"
            )
            if "</body>" in content:
                content = content.replace("</body>", html_section + "</body>", 1)
            else:
                content = content.rstrip() + html_section
            html_path.write_text(content, encoding="utf-8")
        except Exception as exc:
            emit_log(f"Failed to append structured HTML details: {exc}", "warning")


def write_ai_battle_exports(
    *,
    session_id: str,
    report_id: str,
    payload: dict[str, Any],
    primary_path: Path | None,
    rendered_paths: dict[str, str],
) -> dict[str, str]:
    battle_json_path, battle_md_path = _report_export_paths(primary_path)
    if battle_json_path is None or battle_md_path is None:
        return {}

    paths = dict(rendered_paths)
    paths["battleJson"] = str(battle_json_path)
    paths["battleMd"] = str(battle_md_path)
    ai_payload = build_ai_battle_payload(
        session_id=session_id,
        report_id=report_id,
        payload=payload,
        paths=paths,
    )
    try:
        battle_json_path.write_text(json.dumps(ai_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        emit_log(f"Failed to write AI battle JSON: {exc}", "warning")
        battle_json_path = None

    markdown_text = build_ai_battle_markdown(
        session_id=session_id,
        report_id=report_id,
        payload=payload,
        battle_json_path=battle_json_path,
    )
    try:
        battle_md_path.write_text(markdown_text, encoding="utf-8")
    except Exception as exc:
        emit_log(f"Failed to write AI battle markdown: {exc}", "warning")
        battle_md_path = None

    return {
        "battleJson": str(battle_json_path) if battle_json_path is not None else "",
        "battleMd": str(battle_md_path) if battle_md_path is not None else "",
        "structuredMarkdown": markdown_text,
    }


def _report_index_identity(record: dict[str, Any]) -> str:
    return ":".join(
        value
        for value in (
            _as_str(record.get("sessionId")),
            _as_str(record.get("id")),
        )
        if value
    ) or _as_str(record.get("battleJson")) or _as_str(record.get("json"))


def _load_reports_index_records() -> dict[str, dict[str, Any]]:
    records_by_key: dict[str, dict[str, Any]] = {}
    if not REPORTS_INDEX_JSON.exists():
        return records_by_key
    try:
        payload = json.loads(REPORTS_INDEX_JSON.read_text(encoding="utf-8"))
    except Exception:
        return records_by_key
    records = _as_list(payload.get("reports") if isinstance(payload, dict) else payload)
    for item in records:
        record = _as_dict(item)
        key = _report_index_identity(record)
        if key:
            records_by_key[key] = record
    return records_by_key


def update_reports_index(report_payload: dict[str, Any]) -> None:
    entry = _report_history_entry(report_payload)
    entry["sessionId"] = _as_str(report_payload.get("sessionId"))
    entry["battleJson"] = _as_str(report_payload.get("battleJson"))
    entry["battleMd"] = _as_str(report_payload.get("battleMd"))
    entry["indexedAt"] = now_iso()
    key = _report_index_identity(entry)
    if not key:
        return

    try:
        records_by_key = _load_reports_index_records()
        records_by_key[key] = entry
        records = sorted(
            records_by_key.values(),
            key=lambda item: (_as_str(item.get("sessionId")), _as_str(item.get("id"))),
            reverse=True,
        )
        payload = {
            "schema": "battle-reports-index-v1",
            "updatedAt": now_iso(),
            "reportCount": len(records),
            "reportsJsonl": str(REPORTS_INDEX_JSONL),
            "reports": records,
        }
        REPORTS_INDEX_JSON.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(REPORTS_INDEX_JSON, payload)
        _write_jsonl(REPORTS_INDEX_JSONL, records)
    except Exception as exc:
        emit_log(f"Failed to update reports index: {exc}", "warning")


def build_packet_payload(session_id: str, seq: int, artifact: Any) -> dict[str, Any]:
    meta = read_meta(artifact.local_meta_path)
    return {
        "sessionId": session_id,
        "seq": seq,
        "msgId": artifact.msg_id,
        "protoName": artifact.proto_name,
        "timestamp": now_iso(),
        "localDir": str(artifact.local_dir),
        "metaPath": str(artifact.local_meta_path),
        "contentLength": meta.get("contentLength", 0),
    }


def build_report_payload(session_id: str, result: Any) -> dict[str, Any]:
    payload = enrich_report_payload(result.json, load_report_payload(result.json))
    summary = payload.get("summary", {}) if isinstance(payload.get("summary"), dict) else {}
    battle_details = payload.get("battleDetails", {}) if isinstance(payload.get("battleDetails"), dict) else {}
    report_id = result.txt.stem.replace(".readable", "")
    rendered_paths = {
        "txt": str(result.txt),
        "md": str(result.md),
        "csv": str(result.csv),
        "json": str(result.json) if result.json else "",
        "html": str(result.html) if result.html else "",
    }
    export_result = write_ai_battle_exports(
        session_id=session_id,
        report_id=report_id,
        payload=payload,
        primary_path=result.json or result.txt,
        rendered_paths=rendered_paths,
    )
    append_structured_details_to_rendered_files(
        result.md,
        result.html,
        _as_str(export_result.get("structuredMarkdown")),
    )
    report_payload = {
        "sessionId": session_id,
        "id": report_id,
        "txt": str(result.txt),
        "md": str(result.md),
        "csv": str(result.csv),
        "json": str(result.json) if result.json else "",
        "html": str(result.html) if result.html else "",
        "battleJson": _as_str(export_result.get("battleJson")),
        "battleMd": _as_str(export_result.get("battleMd")),
        "eventCount": result.event_count,
        "summary": summary,
        "battleDetails": battle_details,
        "payload": payload,
    }
    update_reports_index(report_payload)
    return report_payload


def _json_ready_payload(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _decoded_payload_path_for_artifact(artifact: Any) -> Path | None:
    local_meta_path = Path(getattr(artifact, "local_meta_path", ""))
    local_dir = Path(getattr(artifact, "local_dir", local_meta_path.parent))

    if local_meta_path.name.endswith(".meta.json"):
        base = local_meta_path.name[: -len(".meta.json")]
        candidate = local_meta_path.with_name(f"{base}.decoded.json")
        if candidate.exists():
            return candidate

    candidate = local_dir / f"{local_dir.name}.decoded.json"
    if candidate.exists():
        return candidate

    candidates = sorted(local_dir.glob("*.decoded.json"))
    return candidates[0] if candidates else None


def _num_or_zero(value: Any) -> int:
    return _to_int(value) or 0


def _compact_id_list(values: list[str]) -> str:
    return " / ".join(value for value in values if value)


def _is_protocol_hero_fallback_name(value: str) -> bool:
    text = value.strip()
    return bool(re.fullmatch(r"#?\d+", text) or re.fullmatch(r"武将\s*#?\d+", text))


def _alliance_hero_name(hero_id: str, raw_name: Any) -> str:
    mapped_name = ALLIANCE_HERO_NAME_OVERRIDES.get(hero_id, "")
    if mapped_name:
        return mapped_name
    name = _as_str(raw_name)
    if name and not _is_protocol_hero_fallback_name(name):
        return name
    # 协议未给可读名（或只给了数字占位）时回退权威词表，
    # 否则词表里的武将(如 1001 许褚)会被误报为"未识别武将"。
    return _authoritative_term(AUTHORITATIVE_HERO_NAMES, hero_id)


def _alliance_hero_display_name(hero_id: str, name: str) -> str:
    if name:
        return name
    return f"未识别武将 {hero_id}" if hero_id else "未知武将"


def _alliance_hero_red_suffix(hero: dict[str, Any]) -> str:
    evolution = _to_int(hero.get("evolution"))
    return f"（{evolution}红）" if evolution is not None else ""


def _alliance_hero_label(hero: dict[str, Any], include_red: bool = False) -> str:
    hero_id = _format_id(hero.get("heroId"))
    name = _alliance_hero_display_name(
        hero_id,
        _alliance_hero_name(hero_id, hero.get("displayName") or hero.get("name")),
    )
    return f"{name}{_alliance_hero_red_suffix(hero)}" if include_red else name


def _alliance_lineup_label(side: dict[str, Any] | None, include_red: bool = False) -> str:
    if side is None:
        return ""
    heroes = [_as_dict(item) for item in _as_list(side.get("heroes"))]
    labels = [_alliance_hero_label(hero, include_red) for hero in heroes if _format_id(hero.get("heroId"))]
    if labels:
        return _compact_id_list(labels)
    ids = [_format_id(item) for item in _as_list(side.get("lineupIds"))]
    return _compact_id_list(
        [
            _alliance_hero_display_name(
                hero_id,
                ALLIANCE_HERO_NAME_OVERRIDES.get(hero_id, "")
                or _authoritative_term(AUTHORITATIVE_HERO_NAMES, hero_id),
            )
            for hero_id in ids
            if hero_id
        ]
    )


def _first_text_value(*values: Any) -> str:
    for value in values:
        text = _as_str(value)
        if text:
            return text
    return ""


def _timestamp_text(value: Any) -> str:
    parsed = _to_int(value)
    if parsed is None or parsed <= 0:
        return ""
    try:
        return datetime.fromtimestamp(parsed).isoformat(timespec="seconds")
    except (OSError, OverflowError, ValueError):
        return str(parsed)


def _location_text(value: Any, fallback: Any = "") -> str:
    parts = [_format_id(item) for item in _as_list(value)]
    text = ",".join(part for part in parts if part)
    return text or _as_str(fallback)


def _build_alliance_attr_list(items: Any, asset_kind: str = "") -> list[dict[str, Any]]:
    attrs: list[dict[str, Any]] = []
    for item in _as_list(items):
        record = _as_dict(item)
        key = _as_str(record.get("key"))
        if not key:
            continue
        raw_value = record.get("val")
        attrs.append(
            {
                "key": key,
                "label": ATTR_LABELS.get(key, key),
                "value": raw_value,
                "name": _asset_attr_display_name(asset_kind, key, _format_id(raw_value), None),
            }
        )
    return attrs


def _build_alliance_skills(items: Any) -> list[dict[str, Any]]:
    skills: list[dict[str, Any]] = []
    for item in _as_list(items):
        if len(skills) >= 3:
            break
        record = _as_dict(item)
        skill_id = _format_id(record.get("skillId"))
        if not skill_id:
            continue
        skills.append(
            {
                "skillId": skill_id,
                "name": _authoritative_term(AUTHORITATIVE_SKILL_NAMES, skill_id),
                "level": _to_int(record.get("level")),
                "orderLevel": _to_int(record.get("orderLevel")),
                "position": _to_int(record.get("position")),
                "showReplace": bool(record.get("showReplace", False)),
            }
        )
    return skills


def _build_alliance_hero(member: dict[str, Any]) -> dict[str, Any]:
    warbooks = _as_dict(member.get("warbooks"))
    warbook_ids = [_format_id(item) for item in _as_list(warbooks.get("idList"))]
    hero_id = _format_id(member.get("heros_id"))
    name = _alliance_hero_name(hero_id, member.get("name"))
    skin_info = _as_dict(member.get("heroSkinInfo"))
    equip_id = _format_id(member.get("equipId"))
    horse_id = _format_id(member.get("horseId"))
    return {
        "heroId": hero_id,
        "name": name,
        "displayName": _alliance_hero_display_name(hero_id, name),
        "heroSkinId": _format_id(skin_info.get("skinId")),
        "heroSkinDynamic": bool(skin_info.get("isDynamic", False)),
        "index": _to_int(member.get("index")),
        "level": _to_int(member.get("hero_lv") or member.get("level")),
        "group": _to_int(member.get("group")),
        "basicArmsId": _to_int(member.get("basicArmsId")),
        "originTroops": _to_int(member.get("origin_troop_num")),
        "armyTroops": _to_int(member.get("army_troop_num")),
        "remainingTroops": _to_int(member.get("troop_num")),
        "wounded": _to_int(member.get("wound_num")),
        "dead": _to_int(member.get("dead_num")),
        "evolution": _to_int(member.get("evolutionNum")),
        "enlighten": _to_int(member.get("enlighten")),
        "skills": _build_alliance_skills(member.get("skills")),
        "warbookIds": [value for value in warbook_ids if value],
        "warbooks": [
            {"warbookId": value, "name": _authoritative_term(AUTHORITATIVE_WARBOOK_NAMES, value)}
            for value in warbook_ids
            if value
        ],
        "warbookItemId": _format_id(warbooks.get("itemId")),
        "equipId": equip_id,
        "equipName": _authoritative_term(AUTHORITATIVE_EQUIPMENT_NAMES, equip_id),
        "horseId": horse_id,
        "horseName": _authoritative_term(AUTHORITATIVE_HORSE_NAMES, horse_id),
        "equipAttrs": _build_alliance_attr_list(member.get("equipData"), "equipment"),
        "horseAttrs": _build_alliance_attr_list(member.get("horseData"), "horse"),
    }


def _build_alliance_heroes(army: dict[str, Any]) -> list[dict[str, Any]]:
    heroes = [
        _build_alliance_hero(member)
        for member in _as_list(army.get("army_member"))
        if isinstance(member, dict)
    ]
    if heroes:
        return sorted(heroes, key=lambda item: item.get("index") or 99)

    fallback: list[dict[str, Any]] = []
    for index, item in enumerate(_as_list(army.get("army_member_extra_info")), start=1):
        record = _as_dict(item)
        hero_id = _format_id(record.get("heros_id"))
        if not hero_id:
            continue
        fallback_name = _alliance_hero_name(hero_id, record.get("name"))
        fallback_skin_info = _as_dict(record.get("heroSkinInfo"))
        fallback.append(
            {
                "heroId": hero_id,
                "name": fallback_name,
                "displayName": _alliance_hero_display_name(hero_id, fallback_name),
                "heroSkinId": _format_id(fallback_skin_info.get("skinId")),
                "heroSkinDynamic": bool(fallback_skin_info.get("isDynamic", False)),
                "index": index,
                "level": _to_int(record.get("level")),
                "group": None,
                "basicArmsId": None,
                "originTroops": None,
                "armyTroops": None,
                "remainingTroops": None,
                "wounded": None,
                "dead": None,
                "evolution": None,
                "enlighten": None,
                "skills": [],
                "warbookIds": [],
                "warbooks": [],
                "warbookItemId": "",
                "equipId": "",
                "equipName": "",
                "horseId": "",
                "horseName": "",
                "equipAttrs": [],
                "horseAttrs": [],
            }
        )
    return fallback


def _hero_total(heroes: list[dict[str, Any]], key: str) -> int:
    return sum(_num_or_zero(hero.get(key)) for hero in heroes)


def _json_safe_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return []
    return _as_list(value)


def _json_safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _build_alliance_side(army: Any, side: str, winner_army_id: str) -> dict[str, Any] | None:
    record = _as_dict(army)
    if not record:
        return None

    avatar = _as_dict(record.get("avatar_data"))
    heroes = _build_alliance_heroes(record)
    lineup_ids = [_format_id(hero.get("heroId")) for hero in heroes if _format_id(hero.get("heroId"))]
    lineup_names = [_as_str(hero.get("displayName")) for hero in heroes if _as_str(hero.get("displayName"))]
    army_id = _format_id(record.get("army_id"))
    formation_id = _format_id(record.get("formationId"))
    totals = {
        "originTroops": _hero_total(heroes, "originTroops"),
        "armyTroops": _hero_total(heroes, "armyTroops"),
        "remainingTroops": _hero_total(heroes, "remainingTroops"),
        "wounded": _hero_total(heroes, "wounded"),
        "dead": _hero_total(heroes, "dead"),
    }
    return {
        "side": side,
        "armyId": army_id,
        "winner": bool(winner_army_id and army_id == winner_army_id),
        "leaderHeroId": _format_id(record.get("army_leader_id")),
        "formationId": formation_id,
        "formationName": _as_str(record.get("formationName")) or _formation_name(formation_id),
        "morale": _to_int(record.get("morale")),
        "originZgNum": _to_int(record.get("originZgNum")),
        "zgNum": _to_int(record.get("zgNum")),
        "merit": _to_int(record.get("zgNum")),
        "totalTroopNum": _to_int(record.get("totalTroopNum")),
        "nowTroopNum": _to_int(record.get("nowTroopNum")),
        "teamExp": _to_int(record.get("teamExp")),
        "costEnergy": _to_int(record.get("costEnergy")),
        "roleId": _to_int(record.get("roleId")),
        "vehicleType": _to_int(record.get("vehicleType")),
        "redifNum": _to_int(record.get("redifNum")),
        "deadAfterBattle": _to_int(record.get("deadAfterBattle")),
        "outsideBuffList": _json_safe_list(record.get("outsideBuffList")),
        "outsideBuffSource": _json_safe_list(record.get("outsideBuffSource")),
        "outsideBuffLvList": _json_safe_list(record.get("outsideBuffLvList")),
        "outOfBattleEffectsList": _json_safe_list(record.get("outOfBattleEffectsList")),
        "seasonOSData": _json_safe_dict(record.get("seasonOSData")),
        "armyCompInfo": _json_safe_dict(record.get("armyCompInfo")),
        "player": {
            "avatarId": _format_id(avatar.get("avatar_id")),
            "name": _as_str(avatar.get("avatar_name")),
            "allianceId": _format_id(avatar.get("avatar_union_id")),
            "allianceName": _as_str(avatar.get("avatar_union_name")),
            "faction": _to_int(avatar.get("faction")),
            "bornStateId": _to_int(avatar.get("bornStateId")),
        },
        "lineupIds": lineup_ids,
        "lineupNames": lineup_names,
        "lineup": _compact_id_list(lineup_names or lineup_ids),
        "heroes": heroes,
        "totals": totals,
    }


def _alliance_result(
    attacker: dict[str, Any] | None,
    defender: dict[str, Any] | None,
    winner_army_id: str,
) -> tuple[str, str]:
    if not winner_army_id or winner_army_id == "0":
        return "draw", "平局"
    if attacker and _format_id(attacker.get("armyId")) == winner_army_id:
        return "attacker_win", "攻方胜"
    if defender and _format_id(defender.get("armyId")) == winner_army_id:
        return "defender_win", "守方胜"
    return "unknown", "未知"


def _troop_line(side: dict[str, Any] | None) -> str:
    if side is None:
        return ""
    totals = _as_dict(side.get("totals"))
    origin = _num_or_zero(totals.get("originTroops"))
    remaining = _num_or_zero(totals.get("remainingTroops"))
    dead = _num_or_zero(totals.get("dead"))
    wounded = _num_or_zero(totals.get("wounded"))
    if origin <= 0 and remaining <= 0 and dead <= 0 and wounded <= 0:
        return ""
    return f"{remaining}/{origin} 伤{wounded} 阵亡{dead}"


def _alliance_side_avatar_id(side: dict[str, Any] | None) -> str:
    if side is None:
        return ""
    player = _as_dict(side.get("player"))
    return _format_id(player.get("avatarId"))


def _alliance_side_merit(side: dict[str, Any] | None) -> int:
    if side is None:
        return 0
    value = side.get("merit")
    if value is None:
        value = side.get("zgNum")
    return _num_or_zero(value)


def _build_alliance_continuous(
    block_record: dict[str, Any],
    attacker: dict[str, Any] | None,
    defender: dict[str, Any] | None,
    child_num: int,
) -> dict[str, Any]:
    other_info = _as_dict(block_record.get("otherInfo"))
    continuous_info = _as_dict(other_info.get("continuousInfo"))
    if not continuous_info:
        return {}

    avatar_id = _format_id(continuous_info.get("avatarId"))
    side_name = ""
    final_battle_merit = 0
    for candidate_name, candidate_side in (("attack", attacker), ("defend", defender)):
        if avatar_id and _alliance_side_avatar_id(candidate_side) == avatar_id:
            side_name = candidate_name
            final_battle_merit = _alliance_side_merit(candidate_side)
            break

    total_merit = _to_int(continuous_info.get("zgNum"))
    chain_merit = None
    if total_merit is not None:
        chain_merit = max(0, total_merit - final_battle_merit)

    return {
        "avatarId": avatar_id,
        "side": side_name,
        "continuousInfoType": _to_int(continuous_info.get("continuousInfoType")),
        "isMulti": bool(continuous_info.get("isMuti", False)),
        "winBattleNum": _to_int(continuous_info.get("winBattleNum")),
        "battleCount": child_num,
        "killNum": _to_int(continuous_info.get("killNum")),
        "totalMerit": total_merit,
        "finalBattleMerit": final_battle_merit,
        "chainMerit": chain_merit,
    }


def _build_alliance_record(
    combat_info: Any,
    *,
    record_type: str,
    session_id: str,
    packet_seq: int,
    msg_id: int,
    proto_name: str,
    meta_path: Path,
    decoded_path: Path,
    index: int,
    parent_battle_id: str = "",
    block: dict[str, Any] | None = None,
    page: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    combat = _as_dict(combat_info)
    if not combat:
        return None

    settlement = _as_dict(combat.get("battleSettlement"))
    winner_army_id = _format_id(settlement.get("winer"))
    attacker = _build_alliance_side(settlement.get("attacker"), "attacker", winner_army_id)
    defender = _build_alliance_side(settlement.get("defensive"), "defender", winner_army_id)
    result_code, result = _alliance_result(attacker, defender, winner_army_id)
    block_record = block or {}
    battle_id = _format_id(combat.get("battleID"))
    child_num = _to_int(block_record.get("childNum")) or _to_int(combat.get("childNum")) or 0
    block_hash = _first_text_value(block_record.get("blockHash"), combat.get("blockHash"))
    combat_hash_key = _first_text_value(block_record.get("combatHashKey"), combat.get("combatHashKey"))
    uid = _format_id(block_record.get("uid") or combat.get("uid"))
    battle_code = _first_text_value(
        block_hash,
        block_record.get("recordKey"),
        combat.get("recordKey"),
        combat.get("battleCode"),
        combat.get("combatCode"),
        combat_hash_key,
        block_record.get("hash"),
        combat.get("hash"),
        battle_id,
    )
    record_key = ":".join(
        value
        for value in (
            "alliance",
            record_type,
            parent_battle_id if record_type == "child" else "",
            battle_code or battle_id,
            str(index),
        )
        if value
    )

    timestamp = combat.get("timeStamp") or combat.get("endTimeStampTime")
    page_record = page or {}
    record: dict[str, Any] = {
        "schema": "alliance-protocol-v1",
        "source": "protocol",
        "recordKey": record_key,
        "recordType": record_type,
        "sessionId": session_id,
        "packetSeq": packet_seq,
        "msgId": msg_id,
        "protoName": proto_name,
        "metaPath": str(meta_path),
        "decodedPath": str(decoded_path),
        "index": index,
        "battleId": battle_id,
        "battleCode": battle_code,
        "combatCode": battle_code,
        "parentBattleId": parent_battle_id,
        "blockHash": block_hash,
        "combatHashKey": combat_hash_key,
        "uid": uid,
        "isNotRead": bool(block_record.get("isNotRead", False)),
        "childNum": child_num,
        "sIndex": _to_int(page_record.get("sIndex")),
        "reqLen": _to_int(page_record.get("reqLen")),
        "tp": _to_int(page_record.get("tp")),
        "timeStamp": _to_int(timestamp),
        "battleTime": _timestamp_text(timestamp),
        "endTimeStampTime": combat.get("endTimeStampTime"),
        "location": _location_text(combat.get("locationOccur"), combat.get("locName")),
        "locationOccur": _as_list(combat.get("locationOccur")),
        "locName": _as_str(combat.get("locName")),
        "matchType": _to_int(combat.get("matchType")),
        "combatType": _to_int(combat.get("combatType")),
        "scenarioId": _to_int(combat.get("scenarioId")),
        "endRound": _to_int(combat.get("endRound")),
        "drawNum": _to_int(combat.get("drawNum")),
        "winnerArmyId": winner_army_id,
        "winnerSide": result_code,
        "result": result,
        "battleResult": result,
        "attacker": attacker,
        "defender": defender,
    }

    continuous = _build_alliance_continuous(block_record, attacker, defender, child_num)
    if continuous:
        record.update(
            {
                "continuous": continuous,
                "continuousAvatarId": continuous.get("avatarId"),
                "continuousSide": continuous.get("side"),
                "continuousWinBattleNum": continuous.get("winBattleNum"),
                "continuousBattleCount": continuous.get("battleCount"),
                "continuousTotalMerit": continuous.get("totalMerit"),
                "continuousChainMerit": continuous.get("chainMerit"),
                "continuousFinalBattleMerit": continuous.get("finalBattleMerit"),
            }
        )

    if attacker is not None:
        player = _as_dict(attacker.get("player"))
        record.update(
            {
                "attackAlliance": _as_str(player.get("allianceName")),
                "attackPlayer": _as_str(player.get("name")),
                "attackLineup": _alliance_lineup_label(attacker),
                "attackLineupWithReds": _alliance_lineup_label(attacker, include_red=True),
                "attackTroops": _troop_line(attacker),
                "attackMerit": _alliance_side_merit(attacker),
                "attackFormationId": _as_str(attacker.get("formationId")),
            }
        )
    if defender is not None:
        player = _as_dict(defender.get("player"))
        record.update(
            {
                "defendAlliance": _as_str(player.get("allianceName")),
                "defendPlayer": _as_str(player.get("name")),
                "defendLineup": _alliance_lineup_label(defender),
                "defendLineupWithReds": _alliance_lineup_label(defender, include_red=True),
                "defendTroops": _troop_line(defender),
                "defendMerit": _alliance_side_merit(defender),
                "defendFormationId": _as_str(defender.get("formationId")),
            }
        )
    return record


def parse_alliance_protocol_records(
    *,
    session_id: str,
    packet_seq: int,
    artifact: Any,
    packet_payload: dict[str, Any],
    decoded_path: Path,
    payload: Any,
) -> list[dict[str, Any]]:
    decoded = _as_dict(payload)
    msg_id = int(packet_payload.get("msgId") or getattr(artifact, "msg_id", 0) or 0)
    proto_name = str(packet_payload.get("protoName") or getattr(artifact, "proto_name", ""))
    page = {
        "sIndex": decoded.get("sIndex"),
        "reqLen": decoded.get("reqLen"),
        "tp": decoded.get("tp"),
    }
    records: list[dict[str, Any]] = []

    if msg_id == 1004:
        for index, item in enumerate(_as_list(decoded.get("blockInfoList")), start=1):
            block = _as_dict(item)
            record = _build_alliance_record(
                block.get("combatInfo"),
                record_type="block",
                session_id=session_id,
                packet_seq=packet_seq,
                msg_id=msg_id,
                proto_name=proto_name,
                meta_path=Path(packet_payload.get("metaPath", "")),
                decoded_path=decoded_path,
                index=index,
                block=block,
                page=page,
            )
            if record is not None:
                records.append(record)
    elif msg_id == 1007:
        parent_battle_id = _format_id(decoded.get("battleID"))
        for index, combat in enumerate(_as_list(decoded.get("combatInfoList")), start=1):
            record = _build_alliance_record(
                combat,
                record_type="child",
                session_id=session_id,
                packet_seq=packet_seq,
                msg_id=msg_id,
                proto_name=proto_name,
                meta_path=Path(packet_payload.get("metaPath", "")),
                decoded_path=decoded_path,
                index=index,
                parent_battle_id=parent_battle_id,
                page=page,
            )
            if record is not None:
                records.append(record)

    return records


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def _report_history_entry(item: dict[str, Any]) -> dict[str, Any]:
    payload = _as_dict(item.get("payload"))
    json_path = _as_str(item.get("json"))
    report_id = _as_str(item.get("id"))
    if not report_id and json_path:
        report_id = Path(json_path).stem.replace(".readable", "")

    summary = _as_dict(item.get("summary")) or _as_dict(payload.get("summary"))
    battle_details = _as_dict(item.get("battleDetails")) or _as_dict(payload.get("battleDetails"))
    event_count = item.get("eventCount", item.get("event_count", 0))

    record: dict[str, Any] = {
        "id": report_id,
        "txt": _as_str(item.get("txt")),
        "md": _as_str(item.get("md")),
        "csv": _as_str(item.get("csv")),
        "json": json_path,
        "html": _as_str(item.get("html")),
        "battleJson": _as_str(item.get("battleJson")),
        "battleMd": _as_str(item.get("battleMd")),
        "event_count": event_count,
        "eventCount": event_count,
    }
    if summary:
        record["summary"] = summary
    if battle_details:
        record["battleDetails"] = battle_details
    return record


def _alliance_record_identity(record: dict[str, Any]) -> str:
    for field in ("battleCode", "combatCode", "blockHash", "combatHashKey", "recordKey"):
        value = _as_str(record.get(field))
        if value:
            return value
    battle_id = _as_str(record.get("battleId"))
    if battle_id:
        parent = _as_str(record.get("parentBattleId"))
        index = _as_str(record.get("index"))
        return ":".join(value for value in (parent, battle_id, index) if value)
    return ""


def _alliance_sort_key(record: dict[str, Any]) -> tuple[int, str, int]:
    return (
        _num_or_zero(record.get("timeStamp")),
        _as_str(record.get("battleCode") or record.get("recordKey") or record.get("battleId")),
        _num_or_zero(record.get("index")),
    )


def _alliance_bundle(
    *,
    session_id: str,
    records: list[dict[str, Any]],
    packet_count: int,
    raw_packets_path: Path,
    packet_index_path: Path,
    persistent: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema": "alliance-protocol-bundle-v1",
        "source": "protocol",
        "sessionId": session_id,
        "updatedAt": now_iso(),
        "packetCount": packet_count,
        "recordCount": len(records),
        "blockCount": sum(1 for record in records if record.get("recordType") == "block"),
        "childCount": sum(1 for record in records if record.get("recordType") == "child"),
        "rawPackets": str(raw_packets_path),
        "packetIndex": str(packet_index_path),
        "records": records,
    }
    if persistent:
        payload["scope"] = "persistent"
        payload["recordsJsonl"] = str(PERSISTENT_ALLIANCE_JSONL)
    return payload


class AllianceProtocolStore:
    def __init__(self, session_dir: Path, session_id: str):
        self.session_dir = session_dir
        self.session_id = session_id
        self.output_dir = session_dir / "alliance_protocol"
        self.raw_packets_path = self.output_dir / "alliance_raw_packets.jsonl"
        self.packet_index_path = self.output_dir / "alliance_packets.jsonl"
        self.records_path = self.output_dir / "alliance_battles.jsonl"
        self.latest_path = self.output_dir / "alliance_battles.latest.json"
        self.session_records_by_key: dict[str, dict[str, Any]] = {}
        self.persistent_records_by_key = self.load_persistent_records()
        self.packet_summaries: list[dict[str, Any]] = []
        self.latest_packet: dict[str, Any] | None = None
        self.latest_dirty = False
        self.last_latest_write_at = 0.0
        self.output_dir.mkdir(parents=True, exist_ok=True)
        PERSISTENT_ALLIANCE_DIR.mkdir(parents=True, exist_ok=True)

    def load_persistent_records(self) -> dict[str, dict[str, Any]]:
        records_by_key: dict[str, dict[str, Any]] = {}
        for record in load_alliance_records(PERSISTENT_ALLIANCE_LATEST):
            key = _alliance_record_identity(record)
            if key:
                records_by_key[key] = record

        for latest_path in sorted(OUTPUT_ROOT.rglob("*alliance_battles.latest.json")):
            if latest_path == self.latest_path or latest_path == PERSISTENT_ALLIANCE_LATEST:
                continue
            for record in load_alliance_records(latest_path):
                key = _alliance_record_identity(record)
                if key and key not in records_by_key:
                    records_by_key[key] = record
        return records_by_key

    def merge_persistent_record(self, record: dict[str, Any]) -> None:
        key = _alliance_record_identity(record)
        if not key:
            return
        now = now_iso()
        existing = self.persistent_records_by_key.get(key)
        if existing is None:
            merged = dict(record)
            merged["firstSeenAt"] = now
            merged["lastSeenAt"] = now
            merged["sessionIds"] = [self.session_id]
            self.persistent_records_by_key[key] = merged
            return

        session_ids = [str(item) for item in _as_list(existing.get("sessionIds")) if _as_str(item)]
        if self.session_id not in session_ids:
            session_ids.append(self.session_id)
        merged = {**existing, **record}
        merged["firstSeenAt"] = _as_str(existing.get("firstSeenAt")) or now
        merged["lastSeenAt"] = now
        merged["sessionIds"] = session_ids
        self.persistent_records_by_key[key] = merged

    def ingest(self, packet_seq: int, artifact: Any, packet_payload: dict[str, Any]) -> list[dict[str, Any]]:
        msg_id = int(packet_payload.get("msgId") or getattr(artifact, "msg_id", 0) or 0)
        if msg_id not in ALLIANCE_PROTOCOL_MSG_IDS:
            return []

        decoded_path = _decoded_payload_path_for_artifact(artifact)
        if decoded_path is None:
            emit_log(f"Alliance protocol packet {msg_id} has no decoded JSON yet", "warning")
            return []

        decoded = _json_ready_payload(decoded_path)
        if decoded is None:
            emit_log(f"Alliance protocol decoded JSON is not ready: {decoded_path}", "warning")
            return []

        records = parse_alliance_protocol_records(
            session_id=self.session_id,
            packet_seq=packet_seq,
            artifact=artifact,
            packet_payload=packet_payload,
            decoded_path=decoded_path,
            payload=decoded,
        )
        page = _as_dict(decoded)
        packet_summary = {
            "sessionId": self.session_id,
            "packetSeq": packet_seq,
            "msgId": msg_id,
            "protoName": packet_payload.get("protoName", ""),
            "capturedAt": now_iso(),
            "metaPath": packet_payload.get("metaPath", ""),
            "decodedPath": str(decoded_path),
            "localDir": packet_payload.get("localDir", ""),
            "recordCount": len(records),
            "recordKeys": [record.get("recordKey", "") for record in records],
            "sIndex": _to_int(page.get("sIndex")),
            "reqLen": _to_int(page.get("reqLen")),
            "tp": _to_int(page.get("tp")),
            "parentBattleId": _format_id(page.get("battleID")),
        }
        self.latest_packet = packet_summary
        self.packet_summaries.append(packet_summary)
        _append_jsonl(self.packet_index_path, packet_summary)
        _append_jsonl(
            self.raw_packets_path,
            {
                **packet_summary,
                "decoded": decoded,
            },
        )

        for record in records:
            key = _alliance_record_identity(record)
            if not key:
                key = f"{record.get('battleId', '')}:{record.get('index', '')}"
            is_new_session_record = key not in self.session_records_by_key
            self.session_records_by_key[key] = record
            self.merge_persistent_record(record)
            if is_new_session_record:
                _append_jsonl(self.records_path, record)

        if records:
            self.write_latest()
        return records

    def session_records(self) -> list[dict[str, Any]]:
        return sorted(self.session_records_by_key.values(), key=_alliance_sort_key, reverse=True)

    def records(self) -> list[dict[str, Any]]:
        return sorted(self.persistent_records_by_key.values(), key=_alliance_sort_key, reverse=True)

    def write_latest(self, force: bool = False) -> None:
        now = time.time()
        if not force and self.last_latest_write_at > 0 and now - self.last_latest_write_at < 5.0:
            self.latest_dirty = True
            return

        self.latest_dirty = False
        self.last_latest_write_at = now
        session_records = self.session_records()
        session_payload = _alliance_bundle(
            session_id=self.session_id,
            records=session_records,
            packet_count=len(self.packet_summaries),
            raw_packets_path=self.raw_packets_path,
            packet_index_path=self.packet_index_path,
            persistent=False,
        )
        _atomic_write_json(self.latest_path, session_payload)

        if force:
            persistent_records = self.records()
            persistent_payload = _alliance_bundle(
                session_id=self.session_id,
                records=persistent_records,
                packet_count=len(self.packet_summaries),
                raw_packets_path=self.raw_packets_path,
                packet_index_path=self.packet_index_path,
                persistent=True,
            )
            PERSISTENT_ALLIANCE_LATEST.write_text(
                json.dumps(persistent_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            _write_jsonl(PERSISTENT_ALLIANCE_JSONL, persistent_records)


def write_session_summary(
    session_dir: Path,
    process_info: dict[str, Any] | None,
    remote_capture_dir: Path | None,
    installed: bool,
    packet_count: int,
    packets: list[dict[str, Any]],
    reports: list[dict[str, Any]],
    alliance_records: list[dict[str, Any]],
    alliance_packets: list[dict[str, Any]] | None = None,
) -> Path:
    payload: dict[str, Any] = {
        "generated_at": now_iso(),
        "scan_workspace": SCAN_WORKSPACE,
        "workspace_output_dir": str(OUTPUT_ROOT),
        "process": process_info or {},
        "remote_capture_dir": str(remote_capture_dir) if remote_capture_dir else "",
        "installed": installed,
        "packet_count": packet_count,
        "raw_packet_count": len(packets),
        "packets": [
            {
                "sessionId": item.get("sessionId", ""),
                "seq": item.get("seq", 0),
                "msgId": item.get("msgId", 0),
                "protoName": item.get("protoName", ""),
                "timestamp": item.get("timestamp", ""),
                "localDir": item.get("localDir", ""),
                "metaPath": item.get("metaPath", ""),
                "contentLength": item.get("contentLength", 0),
            }
            for item in packets
        ],
        "report_count": len(reports),
        "reports": [_report_history_entry(item) for item in reports],
    }
    if alliance_records:
        payload["alliance_records"] = alliance_records
    if alliance_packets:
        payload["alliance_packet_count"] = len(alliance_packets)
        payload["alliance_packets"] = alliance_packets

    target = session_dir / "session_summary.json"
    _atomic_write_json(target, payload)
    return target


def list_processes() -> None:
    import frida  # type: ignore

    device = frida.get_local_device()
    processes: list[dict[str, Any]] = []
    seen: set[int] = set()
    for proc in device.enumerate_processes():
        name_lower = proc.name.lower()
        if "nslg" in name_lower or "bilibili" in name_lower or "sanmou" in name_lower:
            seen.add(int(proc.pid))
            processes.append({"pid": proc.pid, "name": proc.name})

    try:
        config = load_json(DEFAULT_V5_CONFIG)
    except Exception:
        config = {}
    for proc in windows_game_processes(config):
        pid = int(proc.get("pid") or 0)
        if pid > 0 and pid not in seen:
            seen.add(pid)
            processes.append(proc)

    processes.sort(key=lambda item: (item["name"].lower(), item["pid"]))
    print(json.dumps(processes, ensure_ascii=False), flush=True)


def run_passive_capture(args: argparse.Namespace) -> None:
    ensure_import_path(V5_ROOT)
    from capture_sync import CaptureSync  # type: ignore
    from protocol_capture import ProtocolCapture  # type: ignore
    from report_renderer import render_event_file  # type: ignore

    config = load_v5_config(args.process)
    session_dir = create_session_dir(args.label or "capture")
    session_id = session_dir.name
    protocol = ProtocolCapture(config, emit_log)
    packets: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []
    alliance_store = AllianceProtocolStore(session_dir, session_id)
    packet_seq = 0
    battle_packet_count = 0
    installed_emitted = False
    sync: Any = None
    session_start_ts = time.time()
    ready_at: float | None = None
    idle_hint_emitted = False

    stop_event = Event()
    thread: Thread | None = None

    def persist_session_summary() -> Path:
        return write_session_summary(
            session_dir,
            protocol.process_info,
            protocol.remote_capture_dir,
            protocol.installed,
            battle_packet_count,
            packets,
            reports,
            alliance_store.session_records(),
            alliance_store.packet_summaries,
        )

    def emit_session_summary(summary_path: Path, partial: bool) -> None:
        emit(
            "session_summary",
            sessionId=session_id,
            summaryPath=str(summary_path),
            packetCount=battle_packet_count,
            rawPacketCount=len(packets),
            reportCount=len(reports),
            allianceCount=len(alliance_store.session_records()),
            partial=partial,
        )

    try:
        protocol.start()
        emit(
            "connected",
            sessionId=session_id,
            mode="passive",
            outputDir=str(session_dir),
            pid=(protocol.process_info or {}).get("pid", 0),
            name=(protocol.process_info or {}).get("name", ""),
        )

        thread = Thread(
            target=protocol.run_until_stop,
            args=(stop_event, float((config.get("protocol") or {}).get("status_interval_sec", 3.0))),
            daemon=True,
        )
        thread.start()

        render_ids = {int(value) for value in (config.get("protocol") or {}).get("render_msg_ids", [1008])}

        while not STOP_EVENT.is_set():
            if protocol.installed and not installed_emitted:
                installed_emitted = True
                emit(
                    "installed",
                    sessionId=session_id,
                    outputDir=str(session_dir),
                    remoteCaptureDir=str(protocol.remote_capture_dir) if protocol.remote_capture_dir else "",
                )

            if sync is None and protocol.remote_capture_dir is not None:
                protocol_config = dict(config.get("protocol", {}))
                protocol_config["session_start_ts"] = session_start_ts
                sync = CaptureSync(protocol.remote_capture_dir, session_dir / "protocol", protocol_config)
                ready_at = time.time()
                emit(
                    "ready",
                    sessionId=session_id,
                    mode="passive",
                    remoteCaptureDir=str(protocol.remote_capture_dir),
                )

            if sync is not None:
                artifacts = sync.sync_once()
                for artifact in artifacts:
                    idle_hint_emitted = False
                    if getattr(artifact, "emit_packet", True):
                        packet_seq += 1
                        packet_payload = build_packet_payload(session_id, packet_seq, artifact)
                        packets.append(packet_payload)
                        if artifact.msg_id in render_ids:
                            battle_packet_count += 1
                        emit("packet", **packet_payload)

                        if artifact.msg_id in ALLIANCE_PROTOCOL_MSG_IDS:
                            alliance_records = alliance_store.ingest(packet_seq, artifact, packet_payload)
                            if alliance_store.latest_packet is not None:
                                emit("alliance_packet", **alliance_store.latest_packet)
                            if alliance_records:
                                emit(
                                    "alliance_records",
                                    sessionId=session_id,
                                    source="protocol",
                                    path=str(PERSISTENT_ALLIANCE_LATEST),
                                    recordCount=len(alliance_store.persistent_records_by_key),
                                    sessionRecordCount=len(alliance_store.session_records_by_key),
                                )

                    if artifact.msg_id not in render_ids:
                        continue

                    source = getattr(artifact, "render_source_path", None) or artifact.parsed_events_path or artifact.events_path
                    if source is None:
                        continue

                    try:
                        result = render_event_file(source, session_dir / "reports", config.get("report", {}))
                    except Exception as exc:
                        emit_log(f"Report render failed for {artifact.local_dir.name}: {exc}", "warning")
                        continue

                    report_payload = build_report_payload(session_id, result)
                    reports.append(report_payload)
                    emit("report", **report_payload)
                    emit_session_summary(persist_session_summary(), True)

                if (
                    ready_at is not None
                    and not idle_hint_emitted
                    and packet_seq == 0
                    and time.time() - ready_at >= 8.0
                ):
                    idle_hint_emitted = True
                    emit_log(
                        "Passive 模式已就绪，但当前没有新的战报协议流量。请在连接后打开战报详情并点击回放，或触发新的战报请求。",
                        "warning",
                    )

            time.sleep(0.5)
    finally:
        STOP_EVENT.set()
        stop_event.set()
        protocol.stop()
        if thread is not None:
            thread.join(timeout=3)
        alliance_store.write_latest(force=True)
        emit_session_summary(persist_session_summary(), False)
        emit("disconnected", sessionId=session_id, mode="passive")


@dataclass
class LegacyReport:
    session_id: str
    txt: str
    md: str
    csv: str
    json: str
    battle_json: str
    battle_md: str
    event_count: int
    summary: dict[str, Any]
    hero_stats: dict[str, Any]
    deploy: dict[str, Any]
    buffs: dict[str, Any]
    lineup: dict[str, Any]
    events: list[dict[str, Any]]


def save_legacy_report(
    session_dir: Path,
    session_id: str,
    reporter: Any,
    parser: Any,
    report_index: int,
) -> LegacyReport | None:
    if not getattr(parser, "events", None):
        return None

    reports_dir = session_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    stamp = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{report_index:03d}"
    txt_path = reports_dir / f"{stamp}.txt"
    md_path = reports_dir / f"{stamp}.md"
    csv_path = reports_dir / f"{stamp}.csv"
    json_path = reports_dir / f"{stamp}.json"

    txt_report = reporter.generate_text(parser) or ""
    md_report = reporter.generate_markdown(parser) or ""
    csv_report = reporter.generate_csv(parser) or ""

    summary = parser.get_summary()
    payload = {
        "summary": summary,
        "lineup": parser.get_lineup(),
        "hero_stats": parser.get_hero_stats(),
        "deploy": parser.get_deploy_summary(),
        "buffs": parser.get_buff_summary(),
        "events": parser.get_structured_data(),
    }

    txt_path.write_text(txt_report, encoding="utf-8")
    md_path.write_text(md_report, encoding="utf-8")
    csv_path.write_text(csv_report, encoding="utf-8-sig")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    export_result = write_ai_battle_exports(
        session_id=session_id,
        report_id=stamp,
        payload=payload,
        primary_path=json_path,
        rendered_paths={
            "txt": str(txt_path),
            "md": str(md_path),
            "csv": str(csv_path),
            "json": str(json_path),
            "html": "",
        },
    )
    append_structured_details_to_rendered_files(
        md_path,
        None,
        _as_str(export_result.get("structuredMarkdown")),
    )

    return LegacyReport(
        session_id=session_id,
        txt=str(txt_path),
        md=str(md_path),
        csv=str(csv_path),
        json=str(json_path),
        battle_json=_as_str(export_result.get("battleJson")),
        battle_md=_as_str(export_result.get("battleMd")),
        event_count=int(summary.get("total_events", 0)),
        summary=summary,
        hero_stats=payload["hero_stats"],
        deploy=payload["deploy"],
        buffs=payload["buffs"],
        lineup=payload["lineup"],
        events=payload["events"],
    )


def run_v4_hook(args: argparse.Namespace) -> None:
    ensure_import_path(V4_ROOT)
    from alliance_parser import parse_entries, save_alliance_report  # type: ignore
    from frida_client import FridaClient  # type: ignore
    from parser import Parser  # type: ignore
    from reporter import Reporter  # type: ignore

    config = load_v4_config(args.process)
    session_dir = create_session_dir("legacy")
    session_id = session_dir.name
    parser = Parser()
    reporter = Reporter()
    client = FridaClient(config, diagnostic=False)
    reports: list[dict[str, Any]] = []
    alliance_records: list[dict[str, Any]] = []
    last_event_at = 0.0
    report_index = 0
    idle_hint_emitted = False
    hook_started_at = time.time()

    def persist_session_summary(partial: bool, reason: str = "") -> None:
        process_info = {
            "pid": getattr(client.target_process, "pid", 0),
            "name": getattr(client.target_process, "name", ""),
        }
        summary_path = write_session_summary(
            session_dir,
            process_info,
            None,
            True,
            0,
            [],
            reports,
            alliance_records,
        )
        emit(
            "session_summary",
            sessionId=session_id,
            summaryPath=str(summary_path),
            packetCount=0,
            reportCount=len(reports),
            partial=partial,
        )

    def finalise_report(reason: str) -> None:
        nonlocal report_index
        report_index += 1
        report = save_legacy_report(session_dir, session_id, reporter, parser, report_index)
        if report is None:
            return
        payload = {
            "sessionId": report.session_id,
            "id": Path(report.json).stem,
            "txt": report.txt,
            "md": report.md,
            "csv": report.csv,
            "json": report.json,
            "html": "",
            "battleJson": report.battle_json,
            "battleMd": report.battle_md,
            "eventCount": report.event_count,
            "summary": report.summary,
            "payload": {
                "summary": report.summary,
                "hero_stats": report.hero_stats,
                "deploy": report.deploy,
                "buffs": report.buffs,
                "lineup": report.lineup,
                "events": report.events,
                "reason": reason,
            },
        }
        update_reports_index(payload)
        reports.append(payload)
        emit("report", **payload)
        persist_session_summary(True, reason)
        parser.reset()

    def on_event(raw_event: Any) -> None:
        nonlocal idle_hint_emitted, last_event_at
        text = str(raw_event or "").strip()
        if not text:
            return
        last_event_at = time.time()
        idle_hint_emitted = False
        result = parser.feed(text)
        if not result:
            return
        event, battle_end = result
        emit(
            "v4_event",
            sessionId=session_id,
            event={
                "type": event.get("type", ""),
                "phase": event.get("phase", ""),
                "actor": event.get("actor", ""),
                "target": event.get("target", ""),
                "skill": event.get("skill", ""),
                "buff": event.get("buff", ""),
                "raw": event.get("raw", text),
            },
        )
        if len(getattr(parser, "events", [])) % 20 == 0:
            emit(
                "legacy_stats",
                sessionId=session_id,
                summary=parser.get_summary(),
                heroStats=parser.get_hero_stats(),
                deploy=parser.get_deploy_summary(),
            )
        if battle_end:
            finalise_report("battle_end")

    def on_alliance_list(records: list[dict[str, Any]]) -> None:
        nonlocal alliance_records
        alliance_records = [item for item in records if isinstance(item, dict)]
        if not alliance_records:
            return
        save_alliance_report(alliance_records, str(session_dir / "alliance"))
        emit(
            "alliance_records",
            sessionId=session_id,
            path=str(session_dir / "alliance" / "alliance_battles.latest.json"),
            records=alliance_records,
        )

    def on_raw_dump(entries: list[dict[str, Any]], structured: dict[str, Any] | None = None) -> None:
        if not entries:
            return
        try:
            records = parse_entries(entries, structured or {})
        except Exception as exc:
            emit_log(f"Alliance raw parse failed: {exc}", "warning")
            return
        if records:
            on_alliance_list(records)

    client.on_event = on_event
    client.on_info = lambda message: emit_log(str(message))
    client.on_error = lambda message: emit_error(str(message))
    client.on_ready = lambda message: emit("ready", sessionId=session_id, mode="legacy", message=str(message))
    client.on_disconnected = lambda: emit("disconnected", sessionId=session_id, mode="legacy")
    client.on_alliance_list = on_alliance_list
    client.on_raw_dump = on_raw_dump

    started = client.start()
    if not started:
        raise SystemExit(1)

    emit(
        "connected",
        sessionId=session_id,
        mode="legacy",
        outputDir=str(session_dir),
        pid=getattr(client.target_process, "pid", 0),
        name=getattr(client.target_process, "name", ""),
    )

    idle_timeout = float((config.get("parser") or {}).get("idle_timeout_sec", 10))
    try:
        while not STOP_EVENT.is_set():
            if last_event_at and getattr(parser, "events", None):
                if time.time() - last_event_at >= idle_timeout:
                    finalise_report("idle_timeout")
                    last_event_at = 0
            elif not idle_hint_emitted and time.time() - hook_started_at >= 8.0:
                idle_hint_emitted = True
                emit_log(
                    "Legacy 模式已挂钩，但当前没有新的战报文本事件。请打开战报详情并手动点击回放。",
                    "warning",
                )
            time.sleep(0.5)
    finally:
        client.stop()
        if getattr(parser, "events", None):
            finalise_report("stop")
        persist_session_summary(False, "stop")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Battle Grabber V6 bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List game processes")

    passive = sub.add_parser("passive", help="Start V5 passive protocol capture")
    passive.add_argument("process", nargs="?", default="")
    passive.add_argument("--label", default="capture")

    legacy = sub.add_parser("legacy", help="Start V4 text hook capture")
    legacy.add_argument("process", nargs="?", default="")

    return parser


def main() -> None:
    _configure_stdio()
    install_signal_handlers()
    install_stdin_listener()
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "list":
            list_processes()
        elif args.command == "passive":
            run_passive_capture(args)
        elif args.command == "legacy":
            run_v4_hook(args)
        else:
            parser.print_help()
    except KeyboardInterrupt:
        STOP_EVENT.set()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
