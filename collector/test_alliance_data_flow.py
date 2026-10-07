from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flows.alliance_data import (
    _extract_nslg_legion_names,
    _member_join_logs,
    _preview_from_runtime_records,
)


class AllianceDataRuntimeFlowTests(unittest.TestCase):
    def test_extracts_legion_names_from_get_all_legion_info_response(self) -> None:
        payload = {
            "[number]1": {
                "legionList": {
                    "[number]1": {"id": 13, "name": "神行奇佐"},
                    "[number]2": {"legionId": 7, "legionName": "商务台球"},
                }
            }
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {13: "神行奇佐", 7: "商务台球"},
        )

    def test_extracts_legion_names_from_runtime_legions_field(self) -> None:
        payload = {
            "[number]3": {
                "legions": {
                    "[number]1": {"legionId": 3, "legionName": "白板", "legionLeaderId": 10706057735},
                    "[number]2": {"legionId": 7, "legionName": "商务台球", "legionLeaderId": 70005063052},
                }
            }
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {3: "白板", 7: "商务台球"},
        )

    def test_preview_applies_legion_name_mapping_to_members(self) -> None:
        records = [
            {
                "module": "Proxy.AvatarMembers.ImpUnion",
                "func": "SRPC_RPCReqGetAllLegionInfoResponse",
                "time": 1781631478,
                "args": {
                    "[number]1": {
                        "legionList": {
                            "[number]1": {"id": 13, "name": "神行奇佐"},
                            "[number]2": {"id": 7, "name": "商务台球"},
                        }
                    }
                },
            },
            {
                "module": "Proxy.AvatarMembers.ImpUnion",
                "func": "SRPC_RPCReqUnionMemberInfoResponse",
                "time": 1781631479,
                "args": {
                    "[number]3": {
                        "members": {
                            "[number]1": {
                                "avatarId": 10434062160,
                                "avatarName": "福建音音",
                                "roleId": 1,
                                "legionId": 13,
                                "power": 141282,
                            },
                            "[number]2": {
                                "avatarId": 70025065955,
                                "avatarName": "吉伊睡不醒",
                                "roleId": 1,
                                "legionId": 7,
                                "power": 140757,
                            },
                        }
                    }
                },
            },
        ]

        preview = _preview_from_runtime_records(records)
        by_name = {
            item["avatarName"]: item
            for item in preview.get("memberSnapshots", [])
        }

        self.assertEqual(by_name["福建音音"]["legionName"], "神行奇佐")
        self.assertEqual(by_name["吉伊睡不醒"]["legionName"], "商务台球")

    def test_member_name_is_not_treated_as_legion_name(self) -> None:
        payload = {
            "[number]3": {
                "members": {
                    "[number]1": {
                        "id": 10434062160,
                        "avatarName": "福建音音",
                        "name": "福建音音",
                        "legionId": 13,
                        "power": 141282,
                    }
                }
            }
        }

        self.assertEqual(_extract_nslg_legion_names(payload), {})

    def test_extracts_legion_names_from_ui_legion_groups(self) -> None:
        # P1 修复：原先期望值把中文误解码固化为乱码（如 "神行奇佐" 经 utf-8→gbk
        # 误转）。UI 缓存 dump 由 runtime_probe 以 utf-8 解码进入 alliance_data，
        # 应为正确中文，这里改为防回归断言正确中文。
        payload = {
            "source": "UI.Common.UIMgr.uiClsCache",
            "legionGroups": [
                {"legionId": 13, "legionName": "神行奇佐", "uiPath": "UnionMemberUI.ui.legionScrollListCList.listData.1"},
                {"legionId": 7, "legionName": "商务台球", "uiPath": "UnionMemberUI.ui.legionScrollListCList.listData.2"},
            ],
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {13: "神行奇佐", 7: "商务台球"},
        )


class MemberJoinLogsBoundaryTests(unittest.TestCase):
    """P0-2 边界：毫秒级 joinTs / 缺失字段 / 畸形 payload 不应让整单采集失败。"""

    def test_millisecond_join_ts_is_parsed_without_error(self) -> None:
        # 1781631478000 是毫秒级时间戳，直接 datetime.fromtimestamp 会抛
        # ValueError(year out of range)。修复后应自动 //1000 并产出合法 ISO 时间。
        from datetime import datetime

        members = [
            {"avatarName": "玩家甲", "joinTs": "1781631478000"},
            {"avatarName": "玩家乙", "joinTs": 1781631478},  # 已是秒级
        ]
        logs = _member_join_logs(members)
        self.assertEqual(len(logs), 2)
        for log in logs:
            # 应是合法、可回解的 ISO 时间戳（含时区偏移）。
            parsed = datetime.fromisoformat(log["eventTime"])
            self.assertEqual(parsed.year, 2026)

    def test_missing_join_ts_skips_member(self) -> None:
        members = [
            {"avatarName": "无时间玩家"},
            {"avatarName": "有昵称无时间", "joinTs": 0},
        ]
        logs = _member_join_logs(members)
        self.assertEqual(logs, [])

    def test_malformed_join_ts_skips_member_instead_of_crashing(self) -> None:
        # 畸形 payload：joinTs 是非数字字符串 / 嵌套结构，解析失败应跳过该条，
        # 而不是上抛异常导致整单失败。
        members = [
            {"avatarName": "畸形甲", "joinTs": "not-a-number"},
            {"avatarName": "畸形乙", "joinTs": {"weird": 1}},
            {"avatarName": "正常丙", "joinTs": 1781631478},
        ]
        logs = _member_join_logs(members)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["actorName"], "正常丙")


class LegionNameEncodingTests(unittest.TestCase):
    """P1 防回归：UI 缓存中的中文不应被误解码后写进 legionName。"""

    def test_correct_chinese_passes_through_unchanged(self) -> None:
        payload = {
            "legionGroups": [
                {"legionId": 13, "legionName": "神行奇佐"},
                {"legionId": 7, "legionName": "商务台球"},
            ]
        }
        result = _extract_nslg_legion_names(payload)
        self.assertEqual(result, {13: "神行奇佐", 7: "商务台球"})
        # 确保没有把中文误解码成 gbk 乱码（典型乱码含 Private Use Area 字符）。
        for value in result.values():
            self.assertNotIn("�", value)


if __name__ == "__main__":
    unittest.main()
