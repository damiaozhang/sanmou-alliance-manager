from __future__ import annotations

from datetime import datetime
import json
import re
from typing import Any

from .base import flow_list, flow_preview, flow_text
from .alliance_intel import extract_intel_snapshots
from runtime_probe import RuntimeProbeResult


def status_entry(definition: dict[str, Any], capture_type: str) -> dict[str, Any]:
    return {
        "flow": flow_text(definition, "flow", ""),
        "expectedArtifacts": flow_list(definition, "expectedArtifacts", []),
        "navigation": flow_list(definition, "navigation", []),
        "nextProbe": flow_text(definition, "nextProbe", ""),
        "preview": flow_preview(definition),
    }


def build_runtime_capture_payload(
    definition: dict[str, Any],
    capture_type: str,
    result: RuntimeProbeResult,
) -> dict[str, Any]:
    payload = build_capture_payload(definition, capture_type)
    payload["collectorMode"] = "runtime_probe"
    payload["runtime"] = {
        "mode": result.mode,
        "source": result.source,
        "artifactType": result.artifact_type,
        "capturedAt": result.captured_at,
        "recordCount": len(result.records),
    }
    payload["evidence"] = result.evidence()
    payload["preview"] = _preview_from_runtime_records(result.records)
    return payload


def build_capture_payload(definition: dict[str, Any], capture_type: str) -> dict[str, Any]:
    payload = {
        "collectorMode": "preview",
        "captureType": capture_type,
        "flow": flow_text(definition, "flow", ""),
        "expectedArtifacts": flow_list(definition, "expectedArtifacts", []),
        "navigation": flow_list(definition, "navigation", []),
        "nextProbe": flow_text(definition, "nextProbe", ""),
        "preview": flow_preview(definition),
    }
    return payload


def _preview_from_runtime_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    member_snapshots: list[dict[str, Any]] = []
    union_logs: list[dict[str, Any]] = []
    building_snapshots: list[dict[str, Any]] = []
    intel_snapshots: list[dict[str, Any]] = []
    legion_names: dict[int, str] = {}
    legion_groups: list[dict[str, Any]] = []
    seen_legion_groups: set[tuple[int, str]] = set()

    for record in records:
        # 情报域（排行榜/红度/赛季战队/主公簿/同盟建筑/同盟历史）走独立的函数名分派，
        # 与成员/日志/设施的键路径解析互不干扰。
        intel_snapshots.extend(extract_intel_snapshots(record))
        for payload in _record_payloads(record):
            if not isinstance(payload, dict):
                continue
            legion_names.update(_extract_nslg_legion_names(payload))
            legion_groups.extend(
                _extract_legion_groups(payload, seen_legion_groups, _record_time(record))
            )
            member_snapshots.extend(_collect_section(payload, ("memberSnapshots", "members", "member_list")))
            member_snapshots.extend(_extract_nslg_member_snapshots(record, payload))
            union_logs.extend(_collect_section(payload, ("unionLogs", "logs", "union_logs")))
            union_logs.extend(_extract_nslg_union_logs(record, payload))
            building_snapshots.extend(
                _collect_section(payload, ("buildingSnapshots", "buildings", "building_snapshots"))
            )
            building_snapshots.extend(_extract_nslg_building_snapshots(record, payload))

    member_snapshots = _merge_member_snapshots(member_snapshots)
    _apply_legion_names(member_snapshots, legion_names)
    union_logs.extend(_member_join_logs(member_snapshots))
    union_logs = _dedupe_by(union_logs, ("logCategory", "actorName", "targetName", "text"))
    building_snapshots = _dedupe_building_snapshots(building_snapshots)

    preview: dict[str, Any] = {}
    if member_snapshots:
        preview["memberSnapshots"] = member_snapshots
    if legion_groups:
        preview["legionGroups"] = legion_groups
    if union_logs:
        preview["unionLogs"] = union_logs
    if building_snapshots:
        preview["buildingSnapshots"] = building_snapshots
    if intel_snapshots:
        preview["intelSnapshots"] = intel_snapshots
    return preview


def _record_payload(record: dict[str, Any]) -> Any:
    payloads = _record_payloads(record)
    return payloads[0] if payloads else record


def _record_payloads(record: dict[str, Any]) -> list[Any]:
    values: list[Any] = []
    for key in ("payload", "args", "returns", "return", "data", "decoded"):
        value = record.get(key)
        if isinstance(value, str):
            try:
                value = json_loads(value)
            except ValueError:
                continue
        if value is not None:
            values.append(value)
    return values or [record]


def _collect_section(payload: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            return _lua_table_items(value)
    return []


def _extract_nslg_member_snapshots(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections: list[Any] = []
    data = payload.get("[number]3")
    if isinstance(data, dict):
        sections.append(data.get("members"))
    sections.append(payload.get("members"))

    snapshots: list[dict[str, Any]] = []
    seen: set[str] = set()
    for section in sections:
        for member in _lua_table_items(section):
            avatar_id = _first_text(member, ("avatarId", "avatar_id", "memberId", "id"))
            avatar_name = _first_text(member, ("avatarName", "avatar_name", "name"))
            if not avatar_id or not avatar_name or avatar_id in seen:
                continue
            seen.add(avatar_id)
            coord = _first_int(member, ("mainCityCoord", "foundationCoord", "coord"))
            coordinate_x, coordinate_y = _coord_pair(coord)
            role_id = _first_int(member, ("roleId", "role"))
            is_online = bool(member.get("isOnline") or member.get("is_online") or False)
            last_offline_ts = _first_int(member, ("lastOfflineTs", "lastOfflineTime", "lastOfflineAt"))
            weekly_statistics = _runtime_json_value(
                member.get("weeklyStaticsticsData")
                or member.get("weeklyStatistics")
                or member.get("weekly_statistics")
                or {}
            )
            snapshots.append(
                {
                    "observedAt": _record_time(record),
                    "avatarId": avatar_id,
                    "avatarName": avatar_name,
                    "state": _first_text(member, ("state", "onlineState", "status"))
                    or ("在线" if is_online else "离线"),
                    "isOnline": is_online,
                    "officialName": _first_text(
                        member,
                        (
                            "officialName",
                            "official_name",
                            "positionName",
                            "position",
                            "unionRoleName",
                            "titleName",
                            "jobTitle",
                            "officeName",
                            "rankName",
                        ),
                    )
                    or _official_label(_first_int(member, ("type", "officialType", "positionType"))),
                    "professionName": _profession_label(member, role_id),
                    "professionId": _first_int(
                        member,
                        (
                            "professionId",
                            "profession_id",
                            "careerId",
                            "career_id",
                            "occupationId",
                            "occupation_id",
                            "jobId",
                            "job_id",
                        ),
                    )
                    or role_id
                    or 0,
                    "roleId": role_id or 0,
                    "legionName": _first_text(
                        member,
                        ("legionName", "legion_name", "groupName", "group_name"),
                    )
                    or "",
                    "legionId": _first_int(member, ("legionId", "legion_id", "groupId", "group_id", "group"))
                    or 0,
                    "legionLeader": bool(member.get("legionLeader") or member.get("legion_leader") or False),
                    "prosperity": _first_int(member, ("power", "prosperity")) or 0,
                    "weeklyMerit": _first_int(member, ("weeklyMerit", "merit", "feat")) or 0,
                    "weeklyContribution": _first_int(member, ("weeklyContribution", "contri", "contribution")) or 0,
                    "seasonScore": _first_int(member, ("seasonScore", "score")) or 0,
                    "demolitionValue": _first_int(member, ("demolitionValue", "demolition", "demolish", "attack"))
                    or 0,
                    "coordinateX": coordinate_x,
                    "coordinateY": coordinate_y,
                    "lastOfflineTs": last_offline_ts or 0,
                    "joinTs": _first_int(member, ("joinTs", "join_ts", "joinedAt", "joinTime")) or 0,
                    "tFeat": _first_int(member, ("tFeat", "todayFeat", "todayMerit")) or 0,
                    "tForageUse": _first_int(member, ("tForageUse", "todayForageUse")) or 0,
                    "wForageUse": _first_int(member, ("wForageUse", "weekForageUse", "weeklyForageUse")) or 0,
                    "weeklyStatistics": weekly_statistics,
                    "isSelf": bool(member.get("isSelf") or member.get("is_self") or False),
                    "raw": member,
                }
            )
    return snapshots


def _profession_label(member: dict[str, Any], role_id: int | None) -> str:
    known = {"司仓", "奇佐", "神行", "天工", "青囊", "镇军"}
    for key in (
        "professionName",
        "profession",
        "careerName",
        "career",
        "occupationName",
        "occupation",
        "jobName",
        "jobTitle",
    ):
        value = member.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text in known:
            return text
    return _profession_role_label(role_id)


def _profession_role_label(role_id: int | None) -> str:
    if role_id is None:
        return ""
    return {
        1: "司仓",
        2: "镇军",
        3: "奇佐",
        4: "天工",
        5: "青囊",
        6: "神行",
    }.get(role_id, f"职业ID {role_id}")


def _official_label(official_type: int | None) -> str:
    if official_type is None:
        return ""
    return {
        0: "普通成员",
        12: "典军校尉",
        15: "鹰扬校尉",
        16: "虎英校尉",
    }.get(official_type, f"职位ID {official_type}")


def _extract_nslg_union_logs(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    roots = [payload]
    if isinstance(payload.get("[number]1"), dict):
        roots.append(payload["[number]1"])

    logs: list[dict[str, Any]] = []
    for root in roots:
        if not isinstance(root, dict):
            continue
        for list_name, category_prefix in (
            ("unionMailList", "unionMail"),
            ("systemMailList", "systemMail"),
            ("noticeMailList", "noticeMail"),
            ("decreeMailList", "decreeMail"),
        ):
            for item in _lua_table_items(root.get(list_name)):
                text_args = item.get("textArgs")
                if not _has_runtime_content(text_args):
                    continue
                actor = _log_actor(text_args, item)
                target = _log_target(text_args)
                mail_no = _first_text(item, ("mailNo",)) or "unknown"
                log_section = _log_section(category_prefix, mail_no, text_args)
                if log_section == "other":
                    continue
                logs.append(
                    {
                        "eventTime": _record_time(record),
                        "logCategory": f"{category_prefix}:{mail_no}",
                        "logSection": log_section,
                        "actorName": actor,
                        "targetName": target,
                        "text": _format_log_text(log_section, mail_no, text_args),
                        "raw": item,
                    }
                )
    return logs


def _member_join_logs(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    logs: list[dict[str, Any]] = []
    for member in members:
        avatar_name = str(member.get("avatarName") or "").strip()
        join_ts = _first_int(member, ("joinTs", "join_ts"))
        if not avatar_name or not join_ts:
            continue
        # P0-2 修复：joinTs 可能是毫秒级（如 1781631478000）。原代码直接
        # datetime.fromtimestamp(join_ts) 会抛 ValueError(year out of range) /
        # Windows OSError，导致整单采集失败。复用 _record_time 的毫秒分支
        # （>10**12 自动 //1000）与异常兜底；单条解析异常只跳过该成员而非整单失败。
        try:
            event_time = _record_time({"time": join_ts})
        except Exception:  # noqa: BLE001 - 单条时间解析失败不应影响整单
            continue
        logs.append(
            {
                "eventTime": event_time,
                "logCategory": "personnel:join",
                "logSection": "personnel",
                "actorName": avatar_name,
                "targetName": "同盟",
                "text": f"{avatar_name}加入了同盟",
                "raw": {"avatarName": avatar_name, "joinTs": join_ts},
            }
        )
    return logs


def _log_section(category_prefix: str, mail_no: str, text_args: dict[str, Any]) -> str:
    mail = str(mail_no)
    if category_prefix == "unionMail" and mail in {"1000007", "1000008"}:
        return "siege"
    if mail in {"1000010", "1000031", "1000310", "1000418", "1090212", "1090213"}:
        return "siege"
    if _is_profession_log(text_args):
        return "profession"
    if mail in {"1000242", "1000291", "1000316", "1000437", "1001172", "1001173"}:
        return "management"
    if mail in {
        "1000019",
        "1000254",
        "1000255",
        "1000261",
        "1000272",
        "1000292",
        "1000449",
        "1000450",
        "1001171",
    }:
        return "city"
    if mail in {"1001336"}:
        return "personnel"
    if "strategy_name" in text_args:
        return "management"
    if "city_name" in text_args and "state_name" in text_args:
        return "city"
    if "avatarList" in text_args:
        return "siege"
    return "other"


def _is_profession_log(text_args: dict[str, Any]) -> bool:
    if any(
        token in key.lower()
        for key in text_args
        for token in ("talent", "skill", "profession", "career")
    ):
        return True
    text = _format_text_args(text_args)
    return bool(re.search(r"军屯|耕作|铸币|开疆|增产", text))


def _format_log_text(section: str, mail_no: str, text_args: dict[str, Any]) -> str:
    mail = str(mail_no)
    player = _clean_log_text(_first_text(text_args, ("player_name", "playerName")) or "")
    city = _clean_log_text(_first_text(text_args, ("city_name", "cityName")) or "")
    coord = _clean_log_text(_first_text(text_args, ("coord",)) or "")
    if mail == "1000007":
        return f"{player or '同盟成员'}对{city or '目标城池'}{coord}宣战"
    if mail == "1000008":
        return f"{player or '同盟成员'}取消了对{city or '目标城池'}{coord}的宣战"
    if mail in {"1090212", "1090213"}:
        city_x = _first_text(text_args, ("cityX", "city_x")) or ""
        city_y = _first_text(text_args, ("cityY", "city_y")) or ""
        city_coord = f"({city_x},{city_y})" if city_x and city_y else coord
        hitter = _clean_log_text(
            _first_text(text_args, ("killsRank1_name", "killRank1_name", "HPRank1_name")) or ""
        )
        duration = _first_text(text_args, ("costTimeStr",)) or ""
        suffix = f"，用时{duration}" if duration else ""
        return f"我方攻占了{city or '城池'}{city_coord}城池，同盟成员{hitter or '未知'}完成了最后一击{suffix}"
    if mail in {"1000010", "1000418"}:
        return _format_bandit_log(text_args)
    if mail == "1000031":
        members = _clean_log_text(_first_text(text_args, ("avatarList",)) or "")
        contribution = _first_text(text_args, ("contribution",)) or ""
        suffix = f"，获得贡献{contribution}" if contribution else ""
        return f"{members or '同盟成员'}完成攻城协作{suffix}"
    if mail == "1000310":
        info = _clean_log_text(_first_text(text_args, ("info",)) or "")
        return info or "城池附近叛军大营已清剿"
    if mail == "1000291":
        name = _clean_log_text(_first_text(text_args, ("strategy_name",)) or "同盟策略")
        desc = _clean_log_text(_first_text(text_args, ("strategy_des",)) or "")
        return f"同盟发动了{name}" + (f"：{desc}" if desc else "")
    if mail == "1000242":
        rank = _first_text(text_args, ("rank",)) or ""
        return f"同盟排行变化至第{rank}名" if rank else "同盟排行发生变化"
    if mail == "1000316":
        level = _first_text(text_args, ("level",)) or ""
        return f"同盟等级提升至{level}级" if level else "同盟等级发生变化"
    if mail == "1000437":
        team_name = _first_text(text_args, ("team_name",)) or ""
        return f"同盟队伍配置发生变化：{team_name}" if team_name else "同盟队伍配置发生变化"
    if mail == "1001172":
        target_city = _clean_log_text(_first_text(text_args, ("target_city_name",)) or "")
        return f"同盟管理了{city or '城池'}{coord}" + (f"，关联目标{target_city}" if target_city else "")
    if mail == "1001173":
        return f"同盟建筑事件发生在{coord or '未知坐标'}"
    if mail == "1000019":
        start_name = _clean_log_text(_first_text(text_args, ("startName",)) or "")
        start_coord = _clean_log_text(_first_text(text_args, ("startCrood", "startCoord")) or "")
        end_name = _clean_log_text(_first_text(text_args, ("endName",)) or "")
        end_coord = _clean_log_text(_first_text(text_args, ("endCrood", "endCoord")) or "")
        return f"{player or '同盟成员'}从{start_name}{start_coord}迁往{end_name}{end_coord}"
    if mail in {"1000254", "1000255"}:
        level = _first_text(text_args, ("city_level",)) or ""
        seat = _clean_log_text(_first_text(text_args, ("addition_seat",)) or "")
        return f"{city or '城池'}{level}级城池获得{seat}加成"
    if mail == "1000261":
        food = _first_text(text_args, ("food",)) or ""
        percent = _first_text(text_args, ("percent",)) or ""
        return f"城池资源储备达到{percent}%" + (f"，粮草{food}" if food else "")
    if mail == "1000272":
        return f"城池坐标事件发生在{coord or '未知坐标'}"
    if mail == "1000292":
        info = _clean_log_text(_first_text(text_args, ("info",)) or "")
        return f"城池相关信息：{info}" if info else "城池相关信息发生变化"
    if mail in {"1000449", "1000450"}:
        state = _clean_log_text(_first_text(text_args, ("state_name",)) or "")
        return f"{city or '城池'}归属{state or '州郡'}"
    if mail == "1001171":
        cities = _city_names_from_args(text_args)
        return "同盟城池连线发生变化" + (f"：{'、'.join(cities)}" if cities else "")
    if mail == "1001336":
        union_name = _clean_log_text(_first_text(text_args, ("unionName", "union_name")) or "")
        return f"{union_name or '同盟'}发生人员/外交变动"
    return _format_text_args(text_args)


def _clean_log_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", str(value or ""), flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("【", "").replace("】", "")
    return text.strip()


def _format_bandit_log(text_args: dict[str, Any]) -> str:
    bandit_name = _clean_log_text(_first_text(text_args, ("banditName",)) or "叛军")
    player_count = _first_text(text_args, ("bandit_player_number",)) or ""
    exp = _first_text(text_args, ("exp",)) or ""
    rank_desc = _clean_log_text(_first_text(text_args, ("rankDesc",)) or "")
    leader = rank_desc.split(" 灭敌", 1)[0].strip() if rank_desc else ""
    parts = [f"讨伐{bandit_name}完成"]
    if player_count:
        parts.append(f"参与{player_count}队")
    if exp:
        parts.append(f"经验{exp}")
    if leader:
        parts.append(f"战功领先：{leader}")
    return "，".join(parts)


def _city_names_from_args(text_args: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for key in sorted(text_args):
        if not key.startswith("city_name"):
            continue
        name = _clean_log_text(str(text_args[key]))
        if name and name not in names:
            names.append(name)
        if len(names) >= 8:
            break
    return names


def _log_actor(text_args: dict[str, Any], item: dict[str, Any]) -> str:
    return (
        _first_text(
            text_args,
            (
                "player_name",
                "playerName",
                "startName",
                "sender",
                "unionName",
                "HPRank1_name",
                "killsRank1_name",
                "city_name",
            ),
        )
        or _first_text(item, ("actorName", "sender", "jobTitle"))
        or "system"
    )


def _log_target(text_args: dict[str, Any]) -> str:
    return (
        _first_text(
            text_args,
            (
                "city_name",
                "endName",
                "targetName",
                "coord",
                "start_coord",
                "endCrood",
                "receivers",
                "names",
            ),
        )
        or ""
    )


def _extract_nslg_building_snapshots(record: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("[number]3")
    if not isinstance(data, dict):
        return []

    snapshots: list[dict[str, Any]] = []
    for item in _lua_table_items(data.get("list")):
        facility_type_id = _first_int(item, ("type", "roleFacilityType")) or 0
        role_facility_type_id = _first_int(item, ("roleFacilityType",)) or 0
        cfg_id = _first_int(item, ("cfgId",)) or 0
        if facility_type_id == 0 and not _first_int(item, ("coord", "coordinate")):
            continue
        carrier_id = _first_text(item, ("carrierId",)) or ""
        operator_id = _first_text(item, ("operator", "avatarId")) or ""
        operator_name = _first_text(item, ("avatarName", "operatorName")) or ""
        coord = _first_int(item, ("coord", "coordinate"))
        coordinate_x, coordinate_y = _coord_pair(coord)
        status_id = _first_int(item, ("status", "parcelStatus")) or 0
        name = _first_text(item, ("name", "buildingName")) or _facility_display_name(
            facility_type_id,
            role_facility_type_id,
            cfg_id,
        )
        snapshots.append(
            {
                "observedAt": _record_time(record),
                "buildingName": _facility_display_name(
                    facility_type_id,
                    role_facility_type_id,
                    cfg_id,
                    name,
                ),
                "facilityType": _facility_type_label(facility_type_id, role_facility_type_id, cfg_id),
                "facilityTypeId": facility_type_id,
                "roleFacilityType": role_facility_type_id,
                "cfgId": cfg_id,
                "carrierId": carrier_id,
                "level": _facility_level_text(item, facility_type_id),
                "state": _facility_state_label(status_id),
                "statusId": status_id,
                "coordinateX": coordinate_x,
                "coordinateY": coordinate_y,
                "operatorAvatarId": operator_id,
                "operatorName": operator_name,
                "benefit": _first_int(item, ("benefit",)) or 0,
                "mineCount": _first_int(item, ("mineCount",)) or 0,
                "maxMineCount": _first_int(item, ("maxMineCount",)) or 0,
                "effect": _facility_effect_text(item, facility_type_id),
                "raw": item,
            }
        )

    for item in _lua_table_items(data.get("techList")):
        tech_id = _first_text(item, ("techId", "id"))
        if not tech_id:
            continue
        snapshots.append(
            {
                "observedAt": _record_time(record),
                "buildingName": f"tech:{tech_id}",
                "facilityType": "科技",
                "facilityTypeId": 0,
                "roleFacilityType": 0,
                "cfgId": _first_int(item, ("techId", "id")) or 0,
                "carrierId": "",
                "level": f"Lv.{_first_text(item, ('level',)) or '0'}",
                "state": "tech",
                "statusId": 0,
                "coordinateX": 0,
                "coordinateY": 0,
                "operatorAvatarId": "",
                "operatorName": "",
                "benefit": 0,
                "mineCount": 0,
                "maxMineCount": 0,
                "effect": _format_text_args(
                    {key: value for key, value in data.items() if key in {"points", "dailyPoints"}}
                ),
                "raw": item,
            }
        )
    return snapshots


def _extract_nslg_legion_names(payload: dict[str, Any]) -> dict[int, str]:
    mapping: dict[int, str] = {}

    def visit(value: Any, depth: int, path: str) -> None:
        if depth > 8:
            return
        if isinstance(value, dict):
            direct_id = _first_int(value, ("legionId", "legion_id", "groupId", "group_id", "group"))
            direct_name = _first_text(value, ("legionName", "legion_name", "groupName", "group_name"))
            if _looks_like_legion_info(value, path):
                legion_id = direct_id or _first_int(value, ("id", "legion", "legionNo", "legion_no"))
                legion_name = direct_name or _first_text(value, ("name", "title"))
            else:
                legion_id = direct_id
                legion_name = direct_name
            if legion_id and legion_id > 0 and legion_name and legion_name not in {"全体成员", "全部成员", "未分组"}:
                mapping[legion_id] = legion_name
            for key, child in value.items():
                if isinstance(child, (dict, list)):
                    visit(child, depth + 1, f"{path}.{key}" if path else str(key))
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                if isinstance(child, (dict, list)):
                    visit(child, depth + 1, f"{path}[{index}]")

    visit(payload, 0, "")
    return mapping


def _extract_legion_groups(
    payload: dict[str, Any],
    seen: set[tuple[int, str]],
    observed_at: str,
) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for section in (
        payload.get("legionGroups"),
        payload.get("unionGroups"),
        payload.get("groupSnapshots"),
        payload.get("union_group"),
    ):
        for item in _lua_table_items(section):
            raw_scalars = item.get("rawScalars") if isinstance(item.get("rawScalars"), dict) else {}
            legion_id = _first_int(item, ("legionId", "legion_id", "groupId", "group_id", "group", "id"))
            legion_name = _first_text(item, ("legionName", "legion_name", "groupName", "group_name", "name", "title"))
            if not legion_id or legion_id <= 0 or not legion_name:
                continue
            member_count = _first_int(item, ("memberCount", "member_count", "count", "memberNum", "member_num"))
            # 修复：member_count 可能为 None（_first_int 未命中时返回 None），
            # None <= 0 会 TypeError 导致整个采集崩溃。先判 None 再比较。
            if (member_count is None or member_count <= 0) and isinstance(raw_scalars, dict):
                member_count = _first_int(raw_scalars, ("memberCount", "member_count", "count", "memberNum", "member_num"))
            dedupe_key = (legion_id, legion_name)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            groups.append(
                {
                    "groupId": legion_id,
                    "groupName": legion_name,
                    "memberCount": member_count or 0,
                    "observedAt": observed_at,
                    "legionId": legion_id,
                    "legionName": legion_name,
                    "origin": _first_text(item, ("origin",)) or "",
                    "uiName": _first_text(item, ("uiName", "ui_name")) or "",
                    "uiPath": _first_text(item, ("uiPath", "ui_path", "path")) or "",
                    "rawScalars": _runtime_json_value(raw_scalars or {}),
                }
            )
    return groups


def _looks_like_legion_info(value: dict[str, Any], path: str) -> bool:
    keys = {str(key) for key in value.keys()}
    key_text = " ".join(keys).lower()
    path_text = path.lower()
    if any(key in keys for key in ("avatarId", "avatarName", "playerId", "power", "prosperity")):
        return False
    if any(key in keys for key in ("legionName", "legion_name", "groupName", "group_name")):
        return True
    if "legion" in path_text or "legion" in key_text:
        return any(key in keys for key in ("id", "name", "title", "legionId", "legion_id"))
    return False


def _apply_legion_names(items: list[dict[str, Any]], legion_names: dict[int, str]) -> None:
    if not legion_names:
        return
    for item in items:
        if str(item.get("legionName") or "").strip():
            continue
        legion_id = _first_int(item, ("legionId", "legion_id"))
        if legion_id in legion_names:
            item["legionName"] = legion_names[legion_id]


def _facility_display_name(
    facility_type_id: int,
    role_facility_type_id: int,
    cfg_id: int,
    raw_name: str = "",
) -> str:
    clean_name = str(raw_name or "").strip()
    if clean_name and not clean_name.startswith("器械/资源点配置") and not clean_name.endswith(":0"):
        return clean_name
    if facility_type_id == 1:
        return "军屯"
    if facility_type_id == 2:
        return _siege_engine_label(cfg_id)
    if facility_type_id == 5001:
        return "同盟建筑"
    label = _facility_type_label(facility_type_id, role_facility_type_id, cfg_id)
    return f"{label}:{facility_type_id}:{cfg_id}"


def _facility_type_label(facility_type_id: int, role_facility_type_id: int, cfg_id: int) -> str:
    known = {
        1: "军屯",
        5001: "同盟建筑",
    }
    if facility_type_id in known:
        return known[facility_type_id]
    if facility_type_id == 2:
        return "器械"
    if role_facility_type_id:
        return f"设施类型 {role_facility_type_id}"
    if facility_type_id:
        return f"类型ID {facility_type_id}"
    return "未知设施"


def _siege_engine_label(cfg_id: int) -> str:
    return {
        1: "冲车",
        5: "投石车",
        6: "楼船",
    }.get(cfg_id, f"器械 {cfg_id}")


def _facility_level_text(item: dict[str, Any], facility_type_id: int) -> str:
    if facility_type_id == 1:
        return _first_text(item, ("level",)) or ""
    return _first_text(item, ("level",)) or ""


def _facility_effect_text(item: dict[str, Any], facility_type_id: int) -> str:
    benefit = _first_int(item, ("benefit",)) or 0
    mine_count = _first_int(item, ("mineCount",)) or 0
    max_mine_count = _first_int(item, ("maxMineCount",)) or 0
    end_time = _first_int(item, ("endTime",)) or 0
    if facility_type_id == 1:
        parts = []
        if mine_count or max_mine_count:
            parts.append(f"剩余次数：{mine_count}/{max_mine_count}")
        if benefit:
            parts.append(f"收益：{_wan_text(benefit)}")
        if end_time:
            parts.append(f"结束时间：{end_time}")
        return "；".join(parts) or "军屯"
    if facility_type_id == 2:
        return "空闲" if (_first_int(item, ("status", "parcelStatus")) or 0) == 0 else "使用中"
    return _format_text_args(
        {
            key: value
            for key, value in item.items()
            if key in {"benefit", "mineCount", "maxMineCount", "coord", "endTime"}
        }
    )


def _wan_text(value: int) -> str:
    if value >= 10000:
        text = f"{value / 10000:.1f}".rstrip("0").rstrip(".")
        return f"{text}万"
    return str(value)


def _facility_state_label(status_id: int) -> str:
    return {
        0: "空闲",
        1: "操控中",
        2: "建设/占用中",
    }.get(status_id, f"状态ID {status_id}")


def _lua_table_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    indexed: list[tuple[int, dict[str, Any]]] = []
    for key, item in value.items():
        index = _lua_number_key_index(str(key))
        if index is not None and isinstance(item, dict):
            indexed.append((index, item))
    indexed.sort(key=lambda pair: pair[0])
    return [item for _, item in indexed]


def _runtime_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _runtime_json_value(child)
            for key, child in value.items()
            if key not in {"__type", "__count"}
        }
    if isinstance(value, list):
        return [_runtime_json_value(child) for child in value]
    return value


def _has_runtime_content(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return any(key not in {"__type", "__count"} and child not in (None, "", [], {}) for key, child in value.items())


def _lua_number_key_index(key: str) -> int | None:
    prefix = "[number]"
    if not key.startswith(prefix):
        return None
    try:
        return int(key[len(prefix) :])
    except ValueError:
        return None


def _first_text(source: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = source.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _first_int(source: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = source.get(key)
        if value is None:
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _coord_pair(value: int | None) -> tuple[int, int]:
    if not value or value <= 0:
        return (0, 0)
    return (value // 10000, value % 10000)


def _record_time(record: dict[str, Any]) -> str:
    value = record.get("time") or record.get("capturedAt") or record.get("timestamp")
    try:
        if isinstance(value, (int, float)):
            ts = int(value)
            if ts > 10**12:  # 毫秒级
                ts = ts // 1000
            return datetime.fromtimestamp(ts).astimezone().isoformat()
        if isinstance(value, str) and value.strip():
            return value
    except (OverflowError, OSError, ValueError):
        pass
    return datetime.now().astimezone().isoformat()


def _format_text_args(value: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in sorted(value):
        if key in {"__type", "__count"}:
            continue
        text = str(value[key]).strip()
        if not text:
            continue
        if len(text) > 180:
            text = text[:177] + "..."
        parts.append(f"{key}={text}")
        if len(parts) >= 8:
            break
    return "; ".join(parts) or "runtime union event"


def _dedupe_by(items: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, ...], dict[str, Any]] = {}
    for item in items:
        key = tuple(str(item.get(name, "")) for name in keys)
        if any(key):
            deduped[key] = item
    return list(deduped.values())


def _dedupe_building_snapshots(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, ...], dict[str, Any]] = {}
    fallback: list[dict[str, Any]] = []
    for item in items:
        if _is_empty_unknown_facility(item):
            continue
        key = (
            str(item.get("buildingName", "")),
            str(item.get("facilityTypeId", "")),
            str(item.get("cfgId", "")),
            str(item.get("carrierId", "")),
            str(item.get("coordinateX", "")),
            str(item.get("coordinateY", "")),
            str(item.get("operatorAvatarId", "")),
            str(item.get("operatorName", "")),
        )
        if any(key):
            deduped[key] = item
        else:
            fallback.append(item)
    return list(deduped.values()) + fallback


def _is_empty_unknown_facility(item: dict[str, Any]) -> bool:
    facility_type_id = _first_int(item, ("facilityTypeId", "facility_type_id")) or 0
    coordinate_x = _first_int(item, ("coordinateX", "coordinate_x")) or 0
    coordinate_y = _first_int(item, ("coordinateY", "coordinate_y")) or 0
    building_name = str(item.get("buildingName") or item.get("building_name") or "").strip()
    facility_type = str(item.get("facilityType") or item.get("facility_type") or "").strip()
    return (
        facility_type_id == 0
        and coordinate_x == 0
        and coordinate_y == 0
        and (not building_name or building_name.startswith("未知设施"))
        and (not facility_type or facility_type == "未知设施")
    )


def _merge_member_snapshots(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    id_order: list[str] = []
    name_only: dict[str, dict[str, Any]] = {}
    name_order: list[str] = []

    for item in items:
        avatar_id = str(item.get("avatarId") or "").strip()
        avatar_name = str(item.get("avatarName") or "").strip()
        if avatar_id:
            if avatar_id not in by_id:
                by_id[avatar_id] = dict(item)
                id_order.append(avatar_id)
            else:
                _merge_missing_member_fields(by_id[avatar_id], item)
            continue
        if avatar_name:
            if avatar_name not in name_only:
                name_only[avatar_name] = dict(item)
                name_order.append(avatar_name)
            else:
                _merge_missing_member_fields(name_only[avatar_name], item)

    by_name = {
        str(item.get("avatarName") or "").strip(): item
        for item in by_id.values()
        if str(item.get("avatarName") or "").strip()
    }
    for avatar_name in name_order:
        item = name_only[avatar_name]
        existing = by_name.get(avatar_name)
        if existing is not None:
            _merge_missing_member_fields(existing, item)
            continue
        synthetic_id = f"ui:{avatar_name}"
        if synthetic_id not in by_id:
            item["avatarId"] = synthetic_id
            by_id[synthetic_id] = item
            id_order.append(synthetic_id)

    return [by_id[avatar_id] for avatar_id in id_order]


def _merge_missing_member_fields(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key, value in source.items():
        if key == "raw":
            continue
        if value is None or value == "":
            continue
        current = target.get(key)
        if current is None or current == "":
            target[key] = value


def json_loads(value: str) -> Any:
    return json.loads(value)


def build_capture_log(
    definition: dict[str, Any],
    capture_type: str,
    capture_payload: dict[str, Any],
    session_id: str,
) -> dict[str, Any] | None:
    next_probe = capture_payload.get("nextProbe", flow_text(definition, "nextProbe", ""))
    return {"nextProbe": next_probe} if next_probe else None


def build_capture_result(
    definition: dict[str, Any],
    capture_type: str,
    capture_payload: dict[str, Any],
    session_id: str,
) -> dict[str, Any]:
    return {
        "collectorMode": capture_payload.get("collectorMode", "preview"),
        "captureType": capture_type,
        "collectorPayload": capture_payload,
    }


def capture_log_message(definition: dict[str, Any], capture_type: str) -> str:
    return "real Frida/Lua hook integration is pending"
