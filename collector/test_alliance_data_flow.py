"""测试载荷中的玩家、同盟、军团名称和账号 ID 均使用虚构标识。"""

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
                    "[number]1": {"id": 13, "name": "测试军团甲"},
                    "[number]2": {"legionId": 7, "legionName": "测试军团乙"},
                }
            }
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {13: "测试军团甲", 7: "测试军团乙"},
        )

    def test_extracts_legion_names_from_runtime_legions_field(self) -> None:
        payload = {
            "[number]3": {
                "legions": {
                    "[number]1": {"legionId": 3, "legionName": "测试军团丙", "legionLeaderId": 90000002001},
                    "[number]2": {"legionId": 7, "legionName": "测试军团乙", "legionLeaderId": 90000002002},
                }
            }
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {3: "测试军团丙", 7: "测试军团乙"},
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
                            "[number]1": {"id": 13, "name": "测试军团甲"},
                            "[number]2": {"id": 7, "name": "测试军团乙"},
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
                                "avatarId": 90000001001,
                                "avatarName": "测试玩家甲",
                                "roleId": 1,
                                "legionId": 13,
                                "power": 141282,
                            },
                            "[number]2": {
                                "avatarId": 90000001002,
                                "avatarName": "测试玩家乙",
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

        self.assertEqual(by_name["测试玩家甲"]["legionName"], "测试军团甲")
        self.assertEqual(by_name["测试玩家乙"]["legionName"], "测试军团乙")

    def test_member_name_is_not_treated_as_legion_name(self) -> None:
        payload = {
            "[number]3": {
                "members": {
                    "[number]1": {
                        "id": 90000001001,
                        "avatarName": "测试玩家甲",
                        "name": "测试玩家甲",
                        "legionId": 13,
                        "power": 141282,
                    }
                }
            }
        }

        self.assertEqual(_extract_nslg_legion_names(payload), {})

    def test_extracts_legion_names_from_ui_legion_groups(self) -> None:
        # P1 修复：原先期望值把中文误解码固化为乱码（如 "测试军团甲" 经 utf-8→gbk
        # 误转）。UI 缓存 dump 由 runtime_probe 以 utf-8 解码进入 alliance_data，
        # 应为正确中文，这里改为防回归断言正确中文。
        payload = {
            "source": "UI.Common.UIMgr.uiClsCache",
            "legionGroups": [
                {"legionId": 13, "legionName": "测试军团甲", "uiPath": "UnionMemberUI.ui.legionScrollListCList.listData.1"},
                {"legionId": 7, "legionName": "测试军团乙", "uiPath": "UnionMemberUI.ui.legionScrollListCList.listData.2"},
            ],
        }

        self.assertEqual(
            _extract_nslg_legion_names(payload),
            {13: "测试军团甲", 7: "测试军团乙"},
        )

    def test_extracts_legion_names_from_render_data_container(self) -> None:
        # 新增能力：军团列表常常挂在 renderData / renderList 这类「渲染数组」下，
        # 其路径不含 legion/group 字样（历史实测 UnionScheduleWndUI.legionList.N.renderData
        # 才是完整军团列表的来源）。该路径必须能被识别，且成员对象（含 avatar*/power）
        # 不得被误判成军团。
        payload = {
            "[number]1": {
                "legionList": {
                    "[number]1": {
                        "renderData": {
                            "[number]1": {"legionId": 1, "legionName": "默认分组", "memberNum": 64},
                            "[number]2": {"legionId": 3, "legionName": "测试军团丙", "memberNum": 21},
                        }
                    }
                }
            },
            "[number]2": {
                "lastUnionMemberList": {
                    "[number]1": {
                        "id": 90000001001,
                        "avatarName": "测试玩家甲",
                        "legionId": 3,
                        "power": 141282,
                    }
                }
            },
        }

        result = _extract_nslg_legion_names(payload)
        self.assertEqual(result, {1: "默认分组", 3: "测试军团丙"})
        # 成员对象含 avatarName/power，绝不能被当成军团。
        self.assertNotIn(90000001001, result)
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
                {"legionId": 13, "legionName": "测试军团甲"},
                {"legionId": 7, "legionName": "测试军团乙"},
            ]
        }
        result = _extract_nslg_legion_names(payload)
        self.assertEqual(result, {13: "测试军团甲", 7: "测试军团乙"})
        # 确保没有把中文误解码成 gbk 乱码（典型乱码含 Private Use Area 字符）。
        for value in result.values():
            self.assertNotIn("�", value)


if __name__ == "__main__":
    unittest.main()
