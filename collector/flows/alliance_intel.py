"""同盟情报（新增采集域）解析器。

覆盖：全服排行榜 / 全服武将技能红度普查 / 赛季战队（备战区队伍）/ 主公簿（玩家档案）/
同盟建筑 / 同盟历史。

设计要点
--------
1. **按 RPC 函数名分派**。采集侧通过 `__install_rpc_hook__:<模块>|<响应函数>` 挂钩，落库的每条
   record 都带 `func` 字段（如 `RPCGetRankResponse`），这是唯一稳定的分派依据 —— 不能靠猜结构。
2. **结构宽容 + 原始载荷兜底**。游戏协议字段随赛季演进，任何"精确匹配字段名"的解析都会在某次
   更新后静默返回空。因此每个解析器：
     - 尽力提取结构化条目（失败就退化为 0 条）；
     - **始终保留整段原始 payload**，落进 `payload_json`，这样协议变化后可以只改解析器重放历史数据，
       不需要重新采集。
3. **`[number]N` 编码**。collector 的 Lua 序列化把数组写成 `{"[number]1": ..., "[number]2": ...}`，
   本模块统一用 `lua_table_items()` 还原成有序列表（与 flows/alliance_data.py 同一约定）。
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

# ── 公开入口 ──────────────────────────────────────────────────────────────


def extract_intel_snapshots(record: dict[str, Any]) -> list[dict[str, Any]]:
    """把一条 runtime record 解析成若干 intel 快照（可能为空）。"""
    func = str(record.get("func") or "")
    if not func:
        return []
    extractor = _resolve_extractor(func)
    if extractor is None:
        return []
    payloads = _record_payloads(record)
    snapshots: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        try:
            produced = extractor(record, payload)
        except Exception:  # noqa: BLE001 - 单个解析器异常不应中断整单采集
            produced = []
        for snapshot in produced:
            key = (str(snapshot.get("kind", "")), str(snapshot.get("subjectKey", "")))
            if key in seen:
                continue
            seen.add(key)
            snapshot["sourceFunc"] = func
            snapshots.append(snapshot)
    return snapshots


# ── 分派 ──────────────────────────────────────────────────────────────────

# 顺序敏感：先匹配更具体的前缀。
_RULES: list[tuple[re.Pattern[str], Callable[[dict[str, Any], dict[str, Any]], list[dict[str, Any]]]]] = []


def _rule(pattern: str):
    def decorate(func):
        _RULES.append((re.compile(pattern), func))
        return func

    return decorate


def _resolve_extractor(func: str):
    for pattern, extractor in _RULES:
        if pattern.search(func):
            return extractor
    return None


# ── 排行榜 ────────────────────────────────────────────────────────────────

# 榜单项里的"名次"字段；游戏侧大小写不一，统一列一份
_RANK_FIELDS = ("rank", "rankIndex", "rankNo", "pos", "order")
# 榜单值字段：不同榜用不同名字，按优先级取第一个存在的数值
_RANK_VALUE_FIELDS = (
    "value",
    "score",
    "stat",
    "prosperity",
    "wuXun",
    "feat",
    "contri",
    "point",
    "num",
)


@_rule(r"Rank")
def extract_rank_snapshot(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    """排行榜：`ImpRank` 的 `RPCGetRankResponse` / `RPCGetOneRankDataResponse` / …"""
    entries_raw = _find_rank_entries(payload)
    rank_type = _first_text(payload, ("rankType", "type", "rankId", "rankKey", "group"))
    snapshot = {
        "kind": "server_rank",
        "subjectKey": _rank_subject_key(payload, rank_type),
        "subjectLabel": _rank_label(payload, rank_type),
        "observedAt": _record_time(record),
        "observedAtTs": _record_time_ts(record),
        "entries": entries_raw,
        "metrics": _rank_metrics(payload, entries_raw),
        "payload": _plain(payload),
    }
    return [snapshot]


def _find_rank_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """在所有候选数组里挑"最像榜单"的那个（条目多、含名次字段）。"""
    best: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        scored = [item for item in candidate if _first_int(item, _RANK_FIELDS) is not None]
        if len(scored) >= 2 and len(scored) > len(best):
            best = scored
    return [_normalize_rank_entry(item, index + 1) for index, item in enumerate(best)]


def _normalize_rank_entry(item: dict[str, Any], fallback_rank: int) -> dict[str, Any]:
    rank = _first_int(item, _RANK_FIELDS)
    subject_key = _first_text(item, ("pid", "avatarId", "avatar_id", "playerId", "unionId", "id")) or ""
    return {
        "rank": rank if rank is not None else fallback_rank,
        "subjectKey": subject_key,
        "name": _first_text(item, ("name", "avatarName", "unionName", "playerName")) or "",
        "unionName": _first_text(item, ("unionName", "union_name", "union", "allianceName")) or "",
        # 榜单值优先取显式字段，否则退化为"任意第一个数值字段"，
        # 这样即使榜单换了指标名也不会整列变 0
        "value": _first_number(item, _RANK_VALUE_FIELDS) or _first_any_number(item) or 0,
        "extra": _plain(item),
    }


def _rank_subject_key(payload: dict[str, Any], rank_type: str | None) -> str:
    suffix = _first_text(payload, ("suffix", "rankSuffix", "tab", "subType"))
    parts = [part for part in (rank_type, suffix) if part]
    return ":".join(parts) if parts else "default"


def _rank_label(payload: dict[str, Any], rank_type: str | None) -> str:
    named = _first_text(payload, ("rankName", "name", "title", "desc", "tabHint"))
    if named:
        return named
    return f"榜单 {rank_type}" if rank_type else "排行榜"


def _rank_metrics(payload: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, Any] = {"entryCount": len(entries)}
    self_rank = _first_int(payload, ("selfRank", "myRank", "selfRankIndex"))
    self_value = _first_number(payload, ("selfValue", "myValue", "selfScore"))
    if self_rank is not None:
        metrics["selfRank"] = self_rank
    if self_value is not None:
        metrics["selfValue"] = self_value
    return metrics


# ── 武将 / 技能红度普查 ────────────────────────────────────────────────────

_HERO_ID_FIELDS = ("heroId", "sourceId", "heroid", "id", "cfgId")
_EVOLUTION_FIELDS = ("evolution", "evolve", "evo", "star", "advance")
_ENLIGHTEN_FIELDS = ("enlighten", "enlightenment", "awake", "awaken")


@_rule(r"Hero")
def extract_hero_rating(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    """武将红度：`ImpHeros.RPCGetAllAvatarHeroResponse`。

    红度分口径与项目既有约定一致：**单武将 = evolution * 100 + enlighten**
    （见 MEMORY「红度品级分 = evolution总和*100 + enlighten总和」，阵列为 3 将求和）。
    """
    heroes: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        for item in candidate:
            hero_id = _first_int(item, _HERO_ID_FIELDS)
            if hero_id is None:
                continue
            evolution = _first_int(item, _EVOLUTION_FIELDS) or 0
            enlighten = _first_int(item, _ENLIGHTEN_FIELDS) or 0
            has_hero_shape = _has_any(item, ("skill1Id", "skillId", "level", "lv", "arms", "armyTypeId"))
            if has_hero_shape:
                heroes.append(
                    {
                        "rank": 0,
                        "subjectKey": str(hero_id),
                        "name": _first_text(item, ("heroName", "name", "sourceName")) or "",
                        "unionName": "",
                        "value": evolution * 100 + enlighten,
                        "extra": {
                            "evolution": evolution,
                            "enlighten": enlighten,
                            "level": _first_int(item, ("level", "lv")) or 0,
                            **_plain(item),
                        },
                    }
                )
    if not heroes:
        return []
    heroes = _dedupe_by_key(heroes)
    return [
        {
            "kind": "hero_rating",
            "subjectKey": _owner_key(payload),
            "subjectLabel": _owner_label(payload),
            "observedAt": _record_time(record),
            "observedAtTs": _record_time_ts(record),
            "entries": heroes,
            "metrics": {
                "heroCount": len(heroes),
                # 满红阈值与项目既有红度分口径一致：evolution*100 + enlighten ≥ 500 视为满红
                "fullRedCount": sum(1 for hero in heroes if hero["value"] >= 500),
                "totalRedScore": sum(hero["value"] for hero in heroes),
            },
            "payload": _plain(payload),
        }
    ]


# ── 赛季战队 / 备战区队伍 ─────────────────────────────────────────────────


@_rule(r"Team")
def extract_season_team(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    """赛季战队：`ImpSeason` 的 `RPCGetSelfTeamBaseInfoResponse` / `…TeamDetailInfo…` / `…TeamMemberInfo…`"""
    team_id = _first_text(payload, ("teamId", "team_id", "id"))
    name = _first_text(payload, ("teamName", "name", "title")) or ""
    members: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        for item in candidate:
            pid = _first_text(item, ("pid", "avatarId", "memberId", "playerId"))
            if not pid:
                continue
            members.append(
                {
                    "rank": _first_int(item, ("post", "pos", "rank", "order")) or 0,
                    "subjectKey": pid,
                    "name": _first_text(item, ("name", "avatarName", "playerName")) or "",
                    "unionName": _first_text(item, ("unionName", "union_name")) or "",
                    "value": _first_number(item, ("power", "prosperity", "score", "feat")) or 0,
                    "extra": _plain(item),
                }
            )
    snapshot = {
        "kind": "season_team",
        "subjectKey": team_id or "self",
        "subjectLabel": name or "赛季战队",
        "observedAt": _record_time(record),
        "observedAtTs": _record_time_ts(record),
        "entries": _dedupe_by_key(members),
        "metrics": {
            "memberCount": _first_int(payload, ("memberCount", "memberNum", "num")) or len(members),
        },
        "payload": _plain(payload),
    }
    return [snapshot]


# ── 主公簿（玩家档案） ────────────────────────────────────────────────────


@_rule(r"Personal|SimpleData|Profile")
def extract_player_profile(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    """主公簿：`ImpInfo.RPCGetPersonalInformationResponse` / `SRPC_GetSimpleDataViaAvatarIdsResponse`"""
    profiles = _collect_profile_rows(payload)
    if not profiles:
        return []
    return [
        {
            "kind": "player_profile",
            "subjectKey": row["subjectKey"],
            "subjectLabel": row["name"] or row["subjectKey"],
            "observedAt": _record_time(record),
            "observedAtTs": _record_time_ts(record),
            "entries": [row],
            "metrics": row["extra"],
            "payload": _plain(payload) if index == 0 else {},
        }
        for index, row in enumerate(profiles)
    ]


_PROFILE_ID_FIELDS = ("pid", "avatarId", "avatar_id", "playerId", "id", "roleId")
_PROFILE_STAT_FIELDS = (
    "power",
    "prosperity",
    "seasonScore",
    "feat",
    "contri",
    "wuXun",
    "gongXian",
    "officialLv",
    "level",
)


def _collect_profile_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        for item in candidate:
            pid = _first_text(item, _PROFILE_ID_FIELDS)
            if not pid:
                continue
            name = _first_text(item, ("name", "avatarName", "playerName")) or ""
            stats = {field: _first_number(item, (field,)) for field in _PROFILE_STAT_FIELDS}
            stats = {key: value for key, value in stats.items() if value is not None}
            if not name and not stats:
                continue
            rows.append(
                {
                    "rank": 0,
                    "subjectKey": pid,
                    "name": name,
                    "unionName": _first_text(item, ("unionName", "union_name")) or "",
                    "value": stats.get("prosperity", stats.get("power", 0)) or 0,
                    "extra": {**stats, **_plain(item)},
                }
            )
    # 顶层自身档案（没有数组、字段直接挂在 payload 上）
    if not rows:
        pid = _first_text(payload, _PROFILE_ID_FIELDS)
        name = _first_text(payload, ("name", "avatarName", "playerName"))
        if pid or name:
            rows.append(
                {
                    "rank": 0,
                    "subjectKey": pid or name or "self",
                    "name": name or "",
                    "unionName": _first_text(payload, ("unionName", "union_name")) or "",
                    "value": _first_number(payload, ("prosperity", "power")) or 0,
                    "extra": _plain(payload),
                }
            )
    return _dedupe_by_key(rows)


# ── 同盟建筑 / 同盟历史 ───────────────────────────────────────────────────


@_rule(r"UnionBuilding|BuildingInfo")
def extract_union_building(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        for item in candidate:
            key = _first_text(item, ("buildingId", "cfgId", "id", "buildId"))
            if not key:
                continue
            entries.append(
                {
                    "rank": 0,
                    "subjectKey": key,
                    "name": _first_text(item, ("name", "buildingName")) or "",
                    "unionName": "",
                    "value": _first_int(item, ("level", "lv")) or 0,
                    "extra": _plain(item),
                }
            )
    return [
        {
            "kind": "union_building",
            "subjectKey": "default",
            "subjectLabel": "同盟建筑",
            "observedAt": _record_time(record),
            "observedAtTs": _record_time_ts(record),
            "entries": _dedupe_by_key(entries),
            "metrics": {"buildingCount": len(entries)},
            "payload": _plain(payload),
        }
    ]


@_rule(r"UnionHistory")
def extract_union_history(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for candidate in _walk_dict_lists(payload, min_len=1):
        for item in candidate:
            key = _first_text(item, ("eventId", "id", "ts", "time"))
            if not key:
                continue
            entries.append(
                {
                    "rank": 0,
                    "subjectKey": key,
                    "name": _first_text(item, ("title", "name", "desc", "slogan")) or "",
                    "unionName": "",
                    "value": _first_number(item, ("gloryScore", "score", "vote")) or 0,
                    "extra": _plain(item),
                }
            )
    return [
        {
            "kind": "union_history",
            "subjectKey": "default",
            "subjectLabel": "同盟历史",
            "observedAt": _record_time(record),
            "observedAtTs": _record_time_ts(record),
            "entries": _dedupe_by_key(entries),
            "metrics": {"eventCount": len(entries)},
            "payload": _plain(payload),
        }
    ]


# ── 通用工具 ──────────────────────────────────────────────────────────────

_NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")


def _record_payloads(record: dict[str, Any]) -> list[Any]:
    values: list[Any] = []
    for key in ("payload", "args", "returns", "return", "data", "decoded"):
        value = record.get(key)
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                continue
        if isinstance(value, dict) and value:
            values.append(value)
    return values


def _plain(value: Any) -> Any:
    """剥掉 collector 注入的 `__type/__count/__tostring` 元键，供落库。"""
    if isinstance(value, dict):
        return {
            str(key): _plain(child)
            for key, child in value.items()
            if key not in {"__type", "__count", "__tostring", "__maxDepth", "__cycle", "__truncated"}
        }
    if isinstance(value, list):
        return [_plain(child) for child in value]
    return value


def _lua_table_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    indexed: list[tuple[int, dict[str, Any]]] = []
    for key, item in value.items():
        match = re.match(r"^\[number\](\d+)$", str(key))
        if match and isinstance(item, dict):
            indexed.append((int(match.group(1)), item))
        elif str(key).isdigit() and isinstance(item, dict):
            indexed.append((int(str(key)), item))
    indexed.sort(key=lambda pair: pair[0])
    return [item for _, item in indexed]


def _walk_dict_lists(value: Any, min_len: int = 1, depth: int = 0) -> list[list[dict[str, Any]]]:
    """递归收集所有"字典列表"，供各解析器挑选。"""
    found: list[list[dict[str, Any]]] = []
    if depth > 10:
        return found
    if isinstance(value, dict):
        items = _lua_table_items(value)
        if len(items) >= min_len:
            found.append(items)
        for child in value.values():
            if isinstance(child, (dict, list)):
                found.extend(_walk_dict_lists(child, min_len, depth + 1))
        return found
    if isinstance(value, list):
        items = [item for item in value if isinstance(item, dict)]
        if len(items) >= min_len:
            found.append(items)
        for child in value:
            if isinstance(child, (dict, list)):
                found.extend(_walk_dict_lists(child, min_len, depth + 1))
    return found


def _first_text(source: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = source.get(key)
        if value is None or isinstance(value, (dict, list)):
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _first_int(source: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = source.get(key)
        if value is None or isinstance(value, (dict, list)):
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _first_number(source: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, bool) or value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _first_any_number(source: dict[str, Any]) -> float | None:
    for key, value in source.items():
        if key.startswith("__") or isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _has_any(source: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(source.get(key) not in (None, "", [], {}) for key in keys)


def _owner_key(payload: dict[str, Any]) -> str:
    return _first_text(payload, ("pid", "avatarId", "avatar_id", "selfPid", "playerId")) or "self"


def _owner_label(payload: dict[str, Any]) -> str:
    return _first_text(payload, ("name", "avatarName", "playerName")) or ""


def _dedupe_by_key(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("subjectKey") or "")
        if not key:
            continue
        deduped.setdefault(key, row)
    return list(deduped.values())


def _record_time_ts(record: dict[str, Any]) -> int:
    value = record.get("time") or record.get("capturedAt") or record.get("timestamp")
    try:
        if isinstance(value, (int, float)):
            ts = int(value)
            return ts // 1000 if ts > 10**12 else ts
    except (OverflowError, ValueError):
        pass
    return 0


def _record_time(record: dict[str, Any]) -> str:
    from datetime import datetime

    ts = _record_time_ts(record)
    if ts:
        try:
            return datetime.fromtimestamp(ts).astimezone().isoformat()
        except (OverflowError, OSError, ValueError):
            pass
    return datetime.now().astimezone().isoformat()
