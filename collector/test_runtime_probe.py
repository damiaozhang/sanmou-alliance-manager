"""测试载荷中的玩家、同盟、军团名称和账号 ID 均使用虚构标识。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from runtime_probe import (
    RuntimeProbeError,
    RuntimeScanTimeoutError,
    _validate_runtime_scan_summary_data,
)


class RuntimeProbeSummaryValidationTests(unittest.TestCase):
    def test_runtime_scan_summary_accepts_payload_hook_counts(self) -> None:
        summary = {
            "counts": {
                "messageTypes": {"send": 30},
                "payloadTypes": {
                    "modules": 1,
                    "hook": 1,
                    "hooks-ready": 1,
                    "scan-skipped": 1,
                    "lua-probe-api": 1,
                    "lua-probe-start": 1,
                    "lua-probe-stage": 14,
                    "lua-probe": 2,
                    "lua-stack": 2,
                    "lua-value": 2,
                    "dump": 2,
                    "lua-probe-cpcall": 2,
                },
            },
            "missingSymbols": [],
        }

        _validate_runtime_scan_summary_data(
            summary,
            ["__dump_rpc_captures__", "__dump_alliance_ui_cache__"],
        )

    def test_runtime_scan_summary_rejects_missing_hooks(self) -> None:
        summary = {
            "counts": {
                "messageTypes": {"send": 30},
                "payloadTypes": {"scan-skipped": 1},
            },
            "missingSymbols": [],
        }

        with self.assertRaisesRegex(RuntimeProbeError, "did not install any hooks"):
            _validate_runtime_scan_summary_data(summary, ["__dump_rpc_captures__"])

    def test_runtime_scan_summary_rejects_install_probe_error(self) -> None:
        summary = {
            "counts": {
                "messageTypes": {"send": 30},
                "payloadTypes": {
                    "hook": 1,
                    "error": 2,
                },
            },
            "missingSymbols": [],
        }

        with self.assertRaisesRegex(RuntimeProbeError, "runtime scan probe failed"):
            _validate_runtime_scan_summary_data(summary, ["__install_alliance_rpc_hooks__"])

    def test_runtime_scan_summary_allows_dump_only_without_hooks(self) -> None:
        summary = {
            "counts": {
                "messageTypes": {"send": 30},
                "payloadTypes": {
                    "scan-skipped": 1,
                    "lua-probe": 3,
                    "dump": 3,
                },
            },
            "missingSymbols": [],
        }

        _validate_runtime_scan_summary_data(summary, [])


class RuntimeScanTimeoutFailFastTests(unittest.TestCase):
    """A wedged game process makes every scan attempt hang; retrying against
    the same process must not multiply the 50s stall."""

    def test_install_timeout_fails_fast_without_retry(self) -> None:
        import os
        import tempfile
        from unittest import mock

        import runtime_probe

        calls: list[str] = []

        def fake_run(process, out_dir, probes, seconds, definition, exit_after):
            calls.append(str(out_dir))
            raise RuntimeScanTimeoutError("runtime scan command timed out")

        with tempfile.TemporaryDirectory() as tmp:
            env = {"SMDC_RUNTIME_SCAN_OUT": tmp}
            with (
                mock.patch.dict(os.environ, env, clear=False),
                mock.patch.object(
                    runtime_probe,
                    "_runtime_scan_status",
                    return_value={"processTarget": "1234"},
                ),
                mock.patch.object(runtime_probe, "_run_runtime_scan", side_effect=fake_run),
            ):
                with self.assertRaises(RuntimeScanTimeoutError):
                    runtime_probe._start_runtime_scan("alliance_data", {})

        # install 阶段超时 → 直接抛出，不再进入 dump 或重试。
        self.assertEqual(len(calls), 1)

    def test_timeout_expired_without_process_attr_raises_readable_error(self) -> None:
        """Python 3.13 的 subprocess.TimeoutExpired 没有 process 属性。
        _run_runtime_scan 的 except 分支若访问 exc.process 会二次崩溃（P2-5 v1 bug）。
        修复后改用 Popen + communicate(timeout)，超时 kill 直接子进程（frida 脚本），
        绝不 kill 游戏进程树，并正常抛出可读的 RuntimeScanTimeoutError。"""
        import subprocess
        import tempfile
        from unittest import mock

        import runtime_probe

        class FakeProc:
            def __init__(self, kill_called=None):
                self.returncode = None
                # 注意：不能用 kill_called or []（空列表是 falsy，会新建列表导致外部断言看不到）
                self._kill_called = kill_called if kill_called is not None else []
                self._communicate_times = 0
                # P0-1 修复后 _run_runtime_scan 会读取 proc.pid 做进程登记，
                # 这里补一个稳定的假 pid（超出真实 pid 范围，避免误杀）。
                self.pid = 999999

            def communicate(self, timeout=None):
                self._communicate_times += 1
                if self._communicate_times == 1:
                    # 第一次 communicate 抛 TimeoutExpired（模拟 frida 卡死）
                    raise subprocess.TimeoutExpired(cmd=["x"], timeout=timeout or 50)
                # 第二次（kill 后）返回残留输出
                return ("partial stdout", "partial stderr")

            def kill(self):
                self._kill_called.append("kill")

        kill_called: list[str] = []
        fake_proc = FakeProc(kill_called)
        # _kill_process_tree 在 Windows 上会 subprocess.run(["taskkill", ...])。
        # 该嵌套 Popen 也会被本 mock 拦到，若复用同一个 fake_proc 会错误地再次
        # 触发 proc.kill()，污染 kill_called 断言。用 state 标记只把第一个 Popen
        # （真正的扫描子进程）映射到 fake_proc，其余（taskkill 等）给一个无副作用
        # 的替身。
        state = {"first": True}

        def fake_popen(*args, **kwargs):
            ctx = mock.MagicMock()
            if state["first"]:
                state["first"] = False
                ctx.__enter__.return_value = fake_proc
            else:
                ctx.__enter__.return_value = mock.MagicMock()
            ctx.__exit__.return_value = False
            return ctx

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "attempt-1" / "install"
            out_dir.mkdir(parents=True, exist_ok=True)
            with mock.patch.object(runtime_probe.subprocess, "Popen", side_effect=fake_popen):
                with self.assertRaises(runtime_probe.RuntimeScanTimeoutError) as ctx:
                    runtime_probe._run_runtime_scan(
                        "8344", out_dir, ["__noop__"], 20, {"installSeconds": 20}, True
                    )
                self.assertIn("timed out", str(ctx.exception))

        # 超时后 kill 了直接子进程（frida 脚本），且绝不 kill 游戏进程
        self.assertEqual(kill_called, ["kill"])


class RuntimeScanDecodeEncodingTests(unittest.TestCase):
    """P1/P0-3 防回归：UI 缓存 dump 中的中文按 UTF-8 解码，不应被误解码。"""

    def test_lua_string_dump_decodes_utf8_chinese(self) -> None:
        import json
        import tempfile

        import runtime_probe

        payload = {
            "module": "Proxy.AvatarMembers.ImpUnion",
            "func": "SRPC_RPCReqUnionMemberInfoResponse",
            "legionName": "测试军团甲",
            "text": "测试中文日志内容",
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            bin_path = Path(tmp) / "capture.bin"
            bin_path.write_bytes(data)
            records = runtime_probe._records_from_lua_string_dump(bin_path)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["legionName"], "测试军团甲")
        self.assertEqual(records[0]["text"], "测试中文日志内容")
        # 确保没有把 UTF-8 字节误解码成 gbk 乱码（含替换符/Private Use 区字符）。
        self.assertNotIn("�", records[0]["legionName"])


if __name__ == "__main__":
    unittest.main()
