"""alliance_intel 解析器单测。名称和账号 ID 均使用虚构标识。

用**游戏同构的合成载荷**（`[number]N` 数组编码 + collector 注入的 `__type/__count` 元键）
覆盖四个新域的分派与提取；重点验证「结构变了也不能整段丢数据」这条底线。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flows.alliance_intel import extract_intel_snapshots  # noqa: E402


def record(func: str, payload: dict, ts: int = 1789315200) -> dict:
    return {"func": func, "time": ts, "returns": {"__type": "table", "__count": 1, **payload}}


def test_rank_snapshot_from_number_encoded_entries() -> None:
    payload = {
        "rankType": "000100cc",
        "[number]1": {"__type": "table", "rank": 1, "pid": 90000003001, "name": "甲", "unionName": "演示同盟甲", "prosperity": 59723},
        "[number]2": {"__type": "table", "rank": 2, "pid": 90000003002, "name": "乙", "unionName": "演示同盟乙", "prosperity": 36898},
    }
    snapshots = extract_intel_snapshots(record("RPCGetRankResponse", payload))
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot["kind"] == "server_rank"
    assert snapshot["subjectKey"] == "000100cc"
    assert snapshot["sourceFunc"] == "RPCGetRankResponse"
    assert [entry["rank"] for entry in snapshot["entries"]] == [1, 2]
    assert snapshot["entries"][0]["value"] == 59723
    assert snapshot["entries"][0]["name"] == "甲"
    assert snapshot["metrics"]["entryCount"] == 2
    # 元键必须被剥掉，否则会污染落库 JSON
    assert "__type" not in snapshot["entries"][0]["extra"]


def test_rank_snapshot_keeps_payload_when_shape_unknown() -> None:
    """认不出条目时仍要落一条快照（保留原始载荷），不能静默丢弃。"""
    snapshots = extract_intel_snapshots(record("RPCGetOneRankDataResponse", {"rankType": "x", "weird": True}))
    assert len(snapshots) == 1
    assert snapshots[0]["entries"] == []
    assert snapshots[0]["payload"]["rankType"] == "x"


def test_hero_rating_uses_evolution_enlighten_formula() -> None:
    payload = {
        "pid": 90000004001,
        "heroes": {
            "[number]1": {"heroId": 5021, "evolution": 5, "enlighten": 3, "level": 50},
            "[number]2": {"heroId": 2014, "evolution": 4, "enlighten": 0, "level": 48},
        },
    }
    snapshots = extract_intel_snapshots(record("RPCGetAllAvatarHeroResponse", payload))
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot["kind"] == "hero_rating"
    assert snapshot["subjectKey"] == "90000004001"
    by_id = {entry["subjectKey"]: entry for entry in snapshot["entries"]}
    assert by_id["5021"]["value"] == 503  # 5 * 100 + 3
    assert by_id["2014"]["value"] == 400
    assert snapshot["metrics"]["fullRedCount"] == 1
    assert snapshot["metrics"]["totalRedScore"] == 903


def test_hero_rating_ignores_plain_id_objects_without_hero_shape() -> None:
    payload = {"heroes": {"[number]1": {"id": 9}}}
    assert extract_intel_snapshots(record("RPCGetAllAvatarHeroResponse", payload)) == []


def test_season_team_members_and_count() -> None:
    payload = {
        "teamId": 88,
        "teamName": "备战区一队",
        "memberCount": 2,
        "members": {
            "[number]1": {"pid": 101, "name": "甲", "post": 1, "power": 35000},
            "[number]2": {"pid": 102, "name": "乙", "post": 2, "power": 33000},
        },
    }
    snapshots = extract_intel_snapshots(record("RPCGetSelfTeamBaseInfoResponse", payload))
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot["kind"] == "season_team"
    assert snapshot["subjectKey"] == "88"
    assert snapshot["subjectLabel"] == "备战区一队"
    assert snapshot["metrics"]["memberCount"] == 2
    assert [entry["subjectKey"] for entry in snapshot["entries"]] == ["101", "102"]


def test_player_profile_from_list_and_from_flat_payload() -> None:
    listed = extract_intel_snapshots(
        record(
            "SRPC_GetSimpleDataViaAvatarIdsResponse",
            {"avatars": {"[number]1": {"pid": 90000005001, "name": "甲", "prosperity": 48088, "unionName": "演示同盟甲"}}},
        )
    )
    assert len(listed) == 1
    assert listed[0]["kind"] == "player_profile"
    assert listed[0]["subjectKey"] == "90000005001"
    assert listed[0]["metrics"]["prosperity"] == 48088

    flat = extract_intel_snapshots(
        record("RPCGetPersonalInformationResponse", {"pid": 9, "name": "乙", "power": 100})
    )
    assert len(flat) == 1
    assert flat[0]["subjectKey"] == "9"
    assert flat[0]["entries"][0]["name"] == "乙"


def test_union_building_and_history() -> None:
    buildings = extract_intel_snapshots(
        record(
            "RPC_GetUnionBuildingInfoResponse",
            {"list": {"[number]1": {"buildingId": 5001, "name": "同盟大殿", "level": 3}}},
        )
    )
    assert buildings[0]["kind"] == "union_building"
    assert buildings[0]["entries"][0]["value"] == 3

    history = extract_intel_snapshots(
        record(
            "SRPC_GetUnionHistoryInfoResponse",
            {"list": {"[number]1": {"eventId": 7, "title": "占洛阳", "gloryScore": 120}}},
        )
    )
    assert history[0]["kind"] == "union_history"
    assert history[0]["entries"][0]["name"] == "占洛阳"


def test_unknown_func_is_ignored() -> None:
    assert extract_intel_snapshots({"func": "SRPC_RPCReqUnionMemberInfoResponse", "returns": {"a": 1}}) == []
    assert extract_intel_snapshots({"returns": {"a": 1}}) == []


def test_time_is_normalized_from_milliseconds() -> None:
    snapshots = extract_intel_snapshots(
        record("RPCGetRankResponse", {"rankType": "t"}, ts=1789315200000)
    )
    assert snapshots[0]["observedAtTs"] == 1789315200
