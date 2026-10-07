from __future__ import annotations

import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collector_sidecar
import runtime_probe


def _fake_handler():
    module = SimpleNamespace(
        build_runtime_capture_payload=lambda definition, capture_type, probe_result: {
            "collectorMode": "runtime_probe",
            "captureType": capture_type,
            "probe": probe_result,
        }
    )
    return SimpleNamespace(
        definition={"handler": "fake"},
        module=module,
        build_capture_payload=lambda: {
            "collectorMode": "runtime_probe",
            "captureType": "fake",
        },
        build_capture_log=lambda capture_payload, session_id: {"nextProbe": "fake"},
        build_capture_result=lambda capture_payload, session_id: {
            "collectorMode": "runtime_probe",
            "captureType": "fake",
        },
        capture_log_message=lambda: "fake capture completed",
    )


class _FakeStdin:
    """Iterable stand-in for sys.stdin consumed by the reader thread."""

    def __init__(self, lines) -> None:
        self._lines = list(lines)

    def __iter__(self):
        return iter(self._lines)


class ScanRecycleTests(unittest.TestCase):
    """P0-1 验证 stop/EOF 时 frida 扫描子进程按 pid 被回收，不成为孤儿进程。"""

    def _start_sleep_child(self) -> subprocess.Popen:
        # 真实 OS 子进程（python sleep），模拟正在运行的 frida 扫描脚本。
        return subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def _feed_stdin(self, lines) -> None:
        patcher = mock.patch.object(
            collector_sidecar.sys, "stdin", _FakeStdin(lines)
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _common_mocks(self) -> list[mock._patch]:
        patches = [
            mock.patch.dict("os.environ", {"SMDC_PROBE_HEARTBEAT_SECONDS": "0.02"}),
            mock.patch.object(collector_sidecar, "emit", side_effect=lambda event: None),
            mock.patch.object(
                collector_sidecar, "capture_flow_handler", return_value=_fake_handler()
            ),
            mock.patch.object(
                collector_sidecar, "runtime_probe_enabled", return_value=True
            ),
            mock.patch.object(
                collector_sidecar, "start_probe", return_value={"records": 0}
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return patches

    def test_kill_scan_process_tree_reaps_registered_child(self) -> None:
        # 单元：kill_scan_process_tree 必须真正杀掉已登记的子进程。
        proc = self._start_sleep_child()
        runtime_probe._register_scan_proc(proc.pid)
        try:
            self.assertIsNone(proc.poll(), "precondition: child alive")
            runtime_probe.kill_scan_process_tree()
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll(), "child should be reaped")
            # pid 注销后再次调用应为 no-op，不报错。
            runtime_probe.kill_scan_process_tree()
        finally:
            if proc.poll() is None:
                proc.kill()

    def test_stop_command_recycles_registered_scan_pid(self) -> None:
        # 集成：sidecar 收到 stop 时应按 pid 强杀正在运行的扫描子进程。
        proc = self._start_sleep_child()
        runtime_probe._register_scan_proc(proc.pid)
        self._common_mocks()
        self._feed_stdin(
            [
                '{"requestId":"r-start","command":"start_capture","payload":{"captureType":"fake"}}',
                '{"requestId":"r-stop","command":"stop","payload":{}}',
            ]
        )
        try:
            result = collector_sidecar.main()
            self.assertEqual(result, 0)
            # stop 分支已调用 kill_scan_process_tree，子进程应被回收。
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll(), "scan child must be reaped after stop")
        finally:
            if proc.poll() is None:
                proc.kill()

    def test_eof_recycles_registered_scan_pid(self) -> None:
        # 集成：stdin EOF 时同样按 pid 回收扫描子进程。
        proc = self._start_sleep_child()
        runtime_probe._register_scan_proc(proc.pid)
        self._common_mocks()
        self._feed_stdin(
            [
                '{"requestId":"r-start","command":"start_capture","payload":{"captureType":"fake"}}',
            ]
        )
        try:
            result = collector_sidecar.main()
            self.assertEqual(result, 0)
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll(), "scan child must be reaped after EOF")
        finally:
            if proc.poll() is None:
                proc.kill()


if __name__ == "__main__":
    unittest.main()
