from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .base import flow_list, flow_preview, flow_text
from runtime_probe import RuntimeProbeResult


BATTLE_FUNC_NAMES = {
    "RPCGetBattleBlockList",
    "RPCGetBattleBlockListResponse",
    "RPCGetDetailCombatInfo",
    "RPCGetDetailCombatInfoResponse",
    "RPCGetTargetCombatList",
    "RPCGetTargetCombatListResponse",
    "RPCGetUnionBattleBlockList",
    "RPCGetUnionBattleBlockListResponse",
    "RPCGetStaticsCombatInfo",
    "RPCGetStaticsCombatInfoResponse",
    "RPCGetChildCombatInfoList",
    "RPCGetChildCombatInfoListResponse",
    "RPCGetUnionChildCombatInfoList",
    "RPCGetUnionChildCombatInfoListResponse",
    "RPCGetAllCombatInfo",
    "RPCGetAllCombatInfoResponse",
    "RPCGetHeroBattleSnapRecords",
    "RPCGetHeroBattleSnapRecordsResponse",
    "RPCGetBattleAllSnapRecords",
    "RPCGetBattleAllSnapRecordsResponse",
    "RPCBattleSearch",
    "RPCBattleSearchResponse",
    "RPCTargetCoordBattleBlockList",
    "RPCTargetCoordBattleBlockListResponse",
    "RPCGetTowerBattleBlockList",
    "RPCGetTowerBattleBlockListResponse",
    "RPCGetTargetUIDOneBattleBlockInfo",
    "RPCGetTargetUIDOneBattleBlockInfoResponse",
    "RPCGetExpeditionBattleBlockList",
    "RPCGetExpeditionBattleBlockListResponse",
    "RPCGetTargetBlockHashBattleBlockInfo",
    "RPCGetTargetBlockHashBattleBlockInfoResponse",
    "RPCStarBattleBlockList",
    "RPCStarBattleBlockListResponse",
}

FORMATION_NAMES = {
    101: "一字阵",
    201: "箕形阵",
    301: "雁形阵",
    401: "鱼鳞阵",
    501: "锥形阵",
    601: "方圆阵",
    701: "钩行阵",
    801: "偃月阵",
}

HERO_NAMES_BY_ID = {
    2003: "诸葛亮",
    2022: "SP诸葛亮",
    3007: "周瑜",
    3018: "SP周瑜",
}

FORMATION_ID_KEYS = (
    "formationId",
    "formation_id",
    "formationCfgId",
    "formation_cfg_id",
    "arrayId",
    "array_id",
    "arrayCfgId",
    "array_cfg_id",
    "battleArrayId",
    "battle_array_id",
    "armyFormationId",
    "army_formation_id",
    "lineupFormationId",
    "lineup_formation_id",
    "formation",
    "array",
)

EXTERNAL_BUFF_KEYS = (
    "externalBuffs",
    "externalBuffIds",
    "externalBuffIdList",
    "externalBuffList",
    "externalBufs",
    "externalBufIds",
    "externalBufIdList",
    "externalBufList",
    "outsideBuffs",
    "outsideBuffIds",
    "extraBuffs",
    "extraBuffIds",
)


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
    return {
        "collectorMode": "preview",
        "captureType": capture_type,
        "flow": flow_text(definition, "flow", ""),
        "expectedArtifacts": flow_list(definition, "expectedArtifacts", []),
        "navigation": flow_list(definition, "navigation", []),
        "nextProbe": flow_text(definition, "nextProbe", ""),
        "preview": flow_preview(definition),
    }


def _preview_from_runtime_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    battle_blocks: list[dict[str, Any]] = []
    lineup_profiles: list[dict[str, Any]] = []
    request_markers: list[dict[str, Any]] = []

    for record in records:
        if not _is_battle_record(record):
            continue
        request_markers.extend(_extract_request_markers(record))
        for payload in _record_payloads(record):
            if not isinstance(payload, (dict, list)):
                continue
            blocks = _extract_battle_blocks(record, payload)
            battle_blocks.extend(blocks)
            lineup_profiles.extend(_extract_lineup_profiles(blocks))

    battle_blocks = _dedupe_by(battle_blocks, ("battleCode", "battleId"))
    lineup_profiles = _dedupe_by(lineup_profiles, ("playerName", "label", "heroes"))

    preview: dict[str, Any] = {}
    if battle_blocks:
        preview["battleBlocks"] = battle_blocks
    if lineup_profiles:
        preview["lineupProfiles"] = lineup_profiles
    if request_markers and not battle_blocks:
        preview["diagnostics"] = {
            "battleRequestCount": len(request_markers),
            "message": "captured battle RPC requests, but no battle response payload was available in this dump",
            "requests": request_markers[:20],
        }
    return preview


def _is_battle_record(record: dict[str, Any]) -> bool:
    func = _record_func(record)
    module = _record_module(record)
    if func in BATTLE_FUNC_NAMES:
        return True
    text = f"{module}.{func}".lower()
    return any(token in text for token in ("battle", "combat"))


def _extract_battle_blocks(record: dict[str, Any], payload: Any) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for item in _deep_dicts(payload):
        candidates.extend(_collect_section(item, ("battleBlocks", "battleBlockList", "battle_block_list")))
        candidates.extend(
            _collect_section(
                item,
                (
                    "combatInfos",
                    "combatInfoList",
                    "combatList",
                    "battleList",
                    "battle_block_list",
                    "list",
                ),
            )
        )
        if _looks_like_battle_block(item):
            candidates.append(item)

    blocks: list[dict[str, Any]] = []
    for index, item in enumerate(candidates):
        detail = item.get("combatInfo") if isinstance(item.get("combatInfo"), dict) else item
        settlement = detail.get("battleSettlement") if isinstance(detail.get("battleSettlement"), dict) else {}
        battle_code = _first_text(
            item,
            (
                "battleCode",
                "battle_code",
                "code",
                "combatCode",
                "combat_code",
                "blockHash",
                "block_hash",
            ),
        )
        battle_id = _first_text(
            item,
            (
                "battleId",
                "battle_id",
                "battleID",
                "combatId",
                "combat_id",
                "reportId",
                "report_id",
                "id",
            ),
        ) or _first_text(detail, ("battleId", "battle_id", "battleID", "combatId", "combat_id", "id"))
        if not battle_code and not battle_id:
            continue
        if not battle_code:
            battle_code = battle_id
        location = _location_text(item) or _location_text(detail)
        match_type = _first_int(item, ("matchType", "match_type", "battleType", "type", "combatType")) or _first_int(
            detail, ("matchType", "match_type", "battleType", "type", "combatType")
        )
        end_round = _first_int(item, ("endRound", "end_round")) or _first_int(
            detail, ("endRound", "end_round")
        )
        attacker = _side_json(item, "attacker")
        if not any(attacker.values()):
            attacker = _side_json(detail, "attacker")
        defender = _side_json(item, "defender")
        if not any(defender.values()):
            defender = _side_json(detail, "defender")
        attacker_army_id = _side_army_id(item, "attacker") or _side_army_id(detail, "attacker")
        defender_army_id = _side_army_id(item, "defender") or _side_army_id(detail, "defender")
        winner_side = (
            _normalize_winner_side(item, attacker_army_id, defender_army_id)
            or _normalize_winner_side(detail, attacker_army_id, defender_army_id)
            or ""
        )
        raw_result = _result_text(item) or _result_text(detail) or ""
        result = raw_result
        if winner_side and raw_result not in {"攻方胜", "守方胜", "平局"}:
            result = _side_result_text(winner_side) or raw_result
        blocks.append(
            {
                "battleId": battle_id or battle_code,
                "battleCode": battle_code,
                "recordIndex": _first_int(item, ("recordIndex", "index")) or index,
                "occurredAt": _record_time(record, item),
                "location": location,
                "matchType": match_type or 0,
                "endRound": end_round or 0,
                "result": result,
                "winnerSide": winner_side,
                "attackerJson": attacker,
                "defenderJson": defender,
                "battlefieldEnvironmentJson": _environment_json(record, detail, location, match_type),
                "raw": _compact_raw(item),
            }
        )
    return blocks


def _extract_lineup_profiles(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    for block in blocks:
        for side in ("enemy", "defender", "attacker"):
            source = block.get("defenderJson") if side in {"enemy", "defender"} else block.get("attackerJson")
            if not isinstance(source, dict):
                continue
            heroes = _heroes_from_side(source)
            player_name = _first_text(source, ("playerName", "name", "avatarName"))
            if not heroes or not player_name:
                continue
            alliance = _first_text(source, ("allianceName", "unionName", "union", "alliance")) or ""
            formation_name = _first_text(source, ("formationName", "formation_name")) or ""
            label_parts = [part for part in (alliance, formation_name, " / ".join(heroes)) if part]
            label = "·".join(label_parts)
            profiles.append(
                {
                    "playerName": player_name,
                    "playerAvatarId": _first_text(source, ("playerAvatarId", "avatarId", "uid", "roleId")) or "",
                    "side": "enemy" if side in {"enemy", "defender"} else "self",
                    "label": label,
                    "heroes": heroes,
                    "sourceBattleId": block.get("battleCode") or block.get("battleId") or "",
                    "confidence": "自动候选",
                    "notes": "runtime battle listener candidate",
                }
            )
    return profiles


def _record_payloads(record: dict[str, Any]) -> list[Any]:
    values: list[Any] = []
    for key in ("payload", "args", "returns", "return", "data", "decoded"):
        value = record.get(key)
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                continue
        if value is not None:
            values.append(value)
    return values or [record]


def _extract_request_markers(record: dict[str, Any]) -> list[dict[str, Any]]:
    args = record.get("args")
    if not isinstance(args, dict):
        return []
    markers: list[dict[str, Any]] = []
    for key in ("[number]2", "[number]3", "[number]4"):
        value = args.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            markers.append(
                {
                    "module": _record_module(record),
                    "func": _record_func(record),
                    "arg": key,
                    "value": str(value),
                    "capturedAt": _record_time(record),
                }
            )
    return markers


def _collect_section(payload: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            return _lua_table_items(value)
    return []


def _deep_dicts(value: Any, max_depth: int = 8) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []

    def walk(current: Any, depth: int) -> None:
        if depth > max_depth:
            return
        if isinstance(current, dict):
            found.append(current)
            for child in current.values():
                walk(child, depth + 1)
        elif isinstance(current, list):
            for child in current:
                walk(child, depth + 1)

    walk(value, 0)
    return found


def _looks_like_battle_block(item: dict[str, Any]) -> bool:
    if _first_text(item, ("battleCode", "battle_code", "combatCode", "combat_code", "blockHash")):
        return True
    if _first_text(item, ("battleId", "battle_id", "combatId", "combat_id", "reportId")):
        keys = {str(key).lower() for key in item}
        return bool(keys & {"attacker", "defender", "attackinfo", "defendinfo", "matchtype", "eventdatalist"})
    return False


def _side_json(item: dict[str, Any], side: str) -> dict[str, Any]:
    settlement = item.get("battleSettlement")
    if isinstance(settlement, dict):
        settlement_aliases = ("attacker",) if side == "attacker" else ("defender", "defensive")
        for key in settlement_aliases:
            value = settlement.get(key)
            if isinstance(value, dict):
                return _compact_side(value)
    aliases = (
        ("attacker", "attackInfo", "attackerInfo", "attackRole", "atkInfo", "leftInfo")
        if side == "attacker"
        else ("defender", "defensive", "defendInfo", "defenderInfo", "defendRole", "defInfo", "rightInfo")
    )
    for key in aliases:
        value = item.get(key)
        if isinstance(value, dict):
            return _compact_side(value)
    prefix = "attack" if side == "attacker" else "defend"
    fallback = {
        "playerName": _first_text(
            item,
            (
                f"{prefix}erName",
                f"{prefix}Name",
                f"{prefix}PlayerName",
                f"{side}Name",
                f"{side}PlayerName",
            ),
        )
        or "",
        "allianceName": _first_text(
            item,
            (f"{prefix}erUnionName", f"{prefix}UnionName", f"{side}UnionName", f"{side}AllianceName"),
        )
        or "",
        "playerAvatarId": _first_text(item, (f"{prefix}erId", f"{prefix}PlayerId", f"{side}Id")) or "",
    }
    fallback.update(_formation_fields(item, prefix=prefix))
    external_buff_ids = _external_buff_ids(item)
    if external_buff_ids:
        fallback["externalBuffIds"] = external_buff_ids
        fallback["unknownExternalBuffIds"] = external_buff_ids
    heroes = _heroes_from_side(item, prefix)
    if heroes:
        fallback["heroes"] = heroes
        fallback["lineup"] = " / ".join(heroes)
    return fallback


def _compact_side(value: dict[str, Any]) -> dict[str, Any]:
    heroes = _heroes_from_side(value)
    result = {
        "playerName": _first_text(value, ("playerName", "name", "avatarName", "roleName", "nickName")) or "",
        "allianceName": _first_text(value, ("allianceName", "unionName", "union", "guildName")) or "",
        "playerAvatarId": _first_text(value, ("playerAvatarId", "avatarId", "roleId", "uid", "playerId")) or "",
    }
    result.update(_formation_fields(value))
    external_buff_ids = _external_buff_ids(value)
    if external_buff_ids:
        result["externalBuffIds"] = external_buff_ids
        result["unknownExternalBuffIds"] = external_buff_ids
    if heroes:
        result["heroes"] = heroes
        result["lineup"] = " / ".join(heroes)
    return result


def _heroes_from_side(value: dict[str, Any], prefix: str = "") -> list[str]:
    for key in ("heroes", "heroList", "heroInfos", "generals", "lineup", "army"):
        section = value.get(key)
        heroes = _hero_names(section)
        if heroes:
            return heroes[:3]
    if prefix:
        names = [
            _hero_name_from_value(
                _first_text(
                    value,
                    (
                        f"{prefix}Hero{index}",
                        f"{prefix}HeroName{index}",
                        f"{prefix}HeroId{index}",
                        f"{prefix}Hero{index}Id",
                        f"{prefix}GeneralId{index}",
                        f"{prefix}General{index}Id",
                    ),
                )
            )
            for index in range(1, 4)
        ]
        heroes = [name for name in names if name]
        if heroes:
            return heroes
    names = []
    for index in range(1, 4):
        name = _hero_name_from_value(
            _first_text(
                value,
                (
                    f"hero{index}",
                    f"heroName{index}",
                    f"hero{index}Name",
                    f"heroId{index}",
                    f"hero{index}Id",
                    f"generalId{index}",
                    f"general{index}Id",
                ),
            )
        )
        if name:
            names.append(name)
    return names


def _hero_names(value: Any) -> list[str]:
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace(",", "/").split("/") if part.strip()]
        return [_hero_name_from_value(part) or part for part in parts[:3]]
    names: list[str] = []
    for item in _lua_table_items(value):
        name = _hero_name_from_item(item)
        if name:
            names.append(name)
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                names.append(_hero_name_from_value(item.strip()) or item.strip())
    return names[:3]


def _hero_name_from_item(item: dict[str, Any]) -> str | None:
    name = _first_text(item, ("heroName", "name", "generalName", "cfgName"))
    if name:
        return _hero_name_from_value(name) or name
    hero_id = _first_text(
        item,
        (
            "heroId",
            "hero_id",
            "heroCfgId",
            "hero_cfg_id",
            "generalId",
            "general_id",
            "cfgId",
            "cfg_id",
            "configId",
            "id",
        ),
    )
    return _hero_name_from_value(hero_id)


def _hero_name_from_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        hero_id = int(float(text))
    except ValueError:
        return text
    return HERO_NAMES_BY_ID.get(hero_id, f"武将{hero_id}")


def _formation_fields(value: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    formation_id = _formation_id(value, prefix)
    if formation_id is None:
        return {}
    return {
        "formationId": formation_id,
        "formationName": FORMATION_NAMES.get(formation_id, f"阵型{formation_id}"),
    }


def _formation_id(value: dict[str, Any], prefix: str = "") -> int | None:
    prefixed_keys: tuple[str, ...] = ()
    if prefix:
        prefixed_keys = (
            f"{prefix}FormationId",
            f"{prefix}Formation",
            f"{prefix}ArrayId",
            f"{prefix}Array",
            f"{prefix}FormationCfgId",
            f"{prefix}ArrayCfgId",
        )
    return _first_int(value, (*prefixed_keys, *FORMATION_ID_KEYS))


def _external_buff_ids(value: dict[str, Any]) -> list[int]:
    ids: list[int] = []
    for key, item in value.items():
        normalized = str(key).lower()
        is_external_buff_key = key in EXTERNAL_BUFF_KEYS or (
            ("external" in normalized or "outside" in normalized or "extra" in normalized)
            and ("buff" in normalized or "buf" in normalized)
        )
        if is_external_buff_key:
            ids.extend(_ids_from_value(item))
    return _dedupe_ints(ids)


def _ids_from_value(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (int, float, str)):
        parsed = _int_from_any(value)
        return [parsed] if parsed is not None else []
    ids: list[int] = []
    for item in _lua_table_items(value):
        ids.extend(_ids_from_dict(item))
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                ids.extend(_ids_from_dict(item))
            else:
                parsed = _int_from_any(item)
                if parsed is not None:
                    ids.append(parsed)
    elif isinstance(value, dict):
        ids.extend(_ids_from_dict(value))
    return ids


def _ids_from_dict(value: dict[str, Any]) -> list[int]:
    direct = _first_int(
        value,
        (
            "id",
            "buffId",
            "buff_id",
            "bufId",
            "buf_id",
            "cfgId",
            "cfg_id",
            "configId",
            "effectId",
            "effect_id",
        ),
    )
    if direct is not None:
        return [direct]
    ids: list[int] = []
    for item in value.values():
        parsed = _int_from_any(item)
        if parsed is not None:
            ids.append(parsed)
    return ids


def _int_from_any(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def _dedupe_ints(values: list[int]) -> list[int]:
    deduped: list[int] = []
    seen: set[int] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _environment_json(
    record: dict[str, Any],
    item: dict[str, Any],
    location: str,
    match_type: int | None,
) -> dict[str, Any]:
    environment = {
        "source": _record_func(record),
        "module": _record_module(record),
        "location": location,
        "matchType": match_type or 0,
        "terrain": _first_text(item, ("terrain", "terrainName", "landform", "mapName")) or "",
        "target": _first_text(item, ("targetName", "buildingName", "cityName", "blockName")) or "",
        "enemyAlliance": _first_text(
            item,
            ("enemyAlliance", "defenderUnionName", "defendUnionName", "rightUnionName"),
        )
        or "",
    }
    environment.update(_formation_fields(item))
    external_buff_ids = _external_buff_ids(item)
    if external_buff_ids:
        environment["externalBuffIds"] = external_buff_ids
        environment["unknownExternalBuffIds"] = external_buff_ids
    return environment


def _compact_raw(item: dict[str, Any]) -> dict[str, Any]:
    return {str(key): item[key] for key in list(item.keys())[:80] if key not in {"eventDataList", "events"}}


def _side_raw(item: dict[str, Any], side: str) -> dict[str, Any]:
    settlement = item.get("battleSettlement")
    if isinstance(settlement, dict):
        for key in ("attacker",) if side == "attacker" else ("defender", "defensive"):
            value = settlement.get(key)
            if isinstance(value, dict):
                return value
    aliases = (
        ("attacker", "attackInfo", "attackerInfo", "attackRole", "atkInfo", "leftInfo")
        if side == "attacker"
        else ("defender", "defensive", "defendInfo", "defenderInfo", "defendRole", "defInfo", "rightInfo")
    )
    for key in aliases:
        value = item.get(key)
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
    return {}


def _side_army_id(item: dict[str, Any], side: str) -> int | None:
    raw = _side_raw(item, side)
    army_id = _first_int(raw, ("army_id", "armyId"))
    if army_id is not None:
        return army_id
    avatar_data = raw.get("avatar_data")
    if isinstance(avatar_data, dict):
        return _first_int(avatar_data, ("avatar_id", "avatarId"))
    return None


def _winer_value(item: dict[str, Any]) -> int | None:
    settlement = item.get("battleSettlement")
    if isinstance(settlement, dict):
        value = _first_int(settlement, ("winer", "winner"))
        if value is not None:
            return value
    return _first_int(item, ("winer", "winner", "winnerArmyId", "winner_army_id", "winSide"))


def _normalize_winner_side(
    item: dict[str, Any],
    attacker_army_id: int | None,
    defender_army_id: int | None,
) -> str:
    explicit = _first_text(item, ("winnerSide", "winner_side"))
    if explicit:
        lowered = explicit.strip().lower()
        if lowered in {"attacker_win", "attack_win", "attacker", "attack"}:
            return "attacker_win"
        if lowered in {"defender_win", "defend_win", "defender", "defend"}:
            return "defender_win"
        if lowered in {"draw", "平局", "平", "0"}:
            return "draw"
    winer = _winer_value(item)
    if winer is None:
        return ""
    if winer == 0:
        return "draw"
    if attacker_army_id is not None and winer == attacker_army_id:
        return "attacker_win"
    if defender_army_id is not None and winer == defender_army_id:
        return "defender_win"
    return ""


def _side_result_text(winner_side: str) -> str:
    if winner_side == "attacker_win":
        return "攻方胜"
    if winner_side == "defender_win":
        return "守方胜"
    if winner_side == "draw":
        return "平局"
    return ""


def _location_text(item: dict[str, Any]) -> str:
    text = _first_text(item, ("location", "locName", "coordText", "coordinate"))
    if text:
        return text
    coord = _first_int(item, ("coord", "targetCoord", "blockCoord", "position", "locationOccur"))
    if coord:
        x, y = _coord_pair(coord)
        if x or y:
            return f"{x},{y}"
    x = _first_int(item, ("x", "coordinateX", "coordX"))
    y = _first_int(item, ("y", "coordinateY", "coordY"))
    if x is not None and y is not None:
        return f"{x},{y}"
    return ""


def _result_text(item: dict[str, Any]) -> str:
    value = _first_text(item, ("result", "battleResult", "winResult", "winState"))
    if value:
        return value
    settlement = item.get("battleSettlement")
    if isinstance(settlement, dict):
        value = _first_text(settlement, ("winer", "winner"))
        if value:
            return value
    winner = _first_text(item, ("winnerSide", "winner_side", "winner", "winSide"))
    if winner:
        return winner
    return ""


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


def _record_time(record: dict[str, Any], item: dict[str, Any] | None = None) -> str:
    item = item or {}
    value = (
        _first_text(item, ("occurredAt", "eventTime", "time", "battleTime", "createTime"))
        or record.get("time")
        or record.get("capturedAt")
        or record.get("timestamp")
    )
    try:
        if isinstance(value, (int, float)):
            ts = int(value)
            if ts > 10**12:  # 毫秒级
                ts = ts // 1000
            return datetime.fromtimestamp(ts).astimezone().isoformat()
        if isinstance(value, str) and value.strip():
            if value.strip().isdigit():
                ts = int(value)
                if ts > 10**12:  # 毫秒级
                    ts = ts // 1000
                return datetime.fromtimestamp(ts).astimezone().isoformat()
            return value
    except (OverflowError, OSError, ValueError):
        pass
    return datetime.now().astimezone().isoformat()


def _record_func(record: dict[str, Any]) -> str:
    return str(record.get("func") or record.get("sourceFunc") or "").strip()


def _record_module(record: dict[str, Any]) -> str:
    return str(record.get("module") or record.get("sourceModule") or "").strip()


def _dedupe_by(items: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, ...], dict[str, Any]] = {}
    for item in items:
        key = tuple(str(item.get(name, "")) for name in keys)
        if any(key):
            deduped[key] = item
    return list(deduped.values())


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
    return "runtime battle listener hook installed; open alliance battle list/details before dump"
