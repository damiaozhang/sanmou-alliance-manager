from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collector_sidecar
from runtime_probe import RuntimeProbeError


def _fake_handler():
    module = SimpleNamespace(
        build_runtime_capture_payload=lambda definition, capture_type, probe_result: {
            "collectorMode": "runtime_probe",
            "captureType": capture_type,
            "probe": probe_result,
        }
    )
    return SimpleNamespace(definition={"handler": "fake"}, module=module)


class ProbeHeartbeatTests(unittest.TestCase):
    def setUp(self) -> None:
        self._env = mock.patch.dict(
            "os.environ", {"SMDC_PROBE_HEARTBEAT_SECONDS": "0.05"}
        )
        self._env.start()
        self.emitted: list[collector_sidecar.SidecarEvent] = []
        self._emit = mock.patch.object(
            collector_sidecar, "emit", side_effect=self.emitted.append
        )
        self._emit.start()

    def tearDown(self) -> None:
        self._emit.stop()
        self._env.stop()

    def _heartbeats(self):
        return [
            event
            for event in self.emitted
            if event.type == "capture_log"
            and event.payload
            and event.payload.get("heartbeat")
        ]

    def test_slow_probe_emits_at_least_one_heartbeat(self) -> None:
        def slow_probe(capture_type, definition):
            time.sleep(0.25)
            return {"records": 1}

        with mock.patch.object(collector_sidecar, "start_probe", side_effect=slow_probe):
            outcome = collector_sidecar._run_probe_with_heartbeats(
                "req-1", "session-1", "alliance_data", _fake_handler()
            )

        heartbeats = self._heartbeats()
        self.assertGreaterEqual(len(heartbeats), 1)
        for event in heartbeats:
            self.assertEqual(event.requestId, "req-1")
            self.assertEqual(event.sessionId, "session-1")
            self.assertEqual(event.status, "info")
            self.assertIn("runtime probe", event.message)
        self.assertEqual(outcome["payload"]["probe"], {"records": 1})

    def test_fast_probe_finishes_without_heartbeat(self) -> None:
        with mock.patch.object(
            collector_sidecar, "start_probe", return_value={"records": 0}
        ):
            outcome = collector_sidecar._run_probe_with_heartbeats(
                "req-2", "session-2", "alliance_data", _fake_handler()
            )

        self.assertEqual(self._heartbeats(), [])
        self.assertIn("payload", outcome)

    def test_probe_error_is_reported_after_heartbeats(self) -> None:
        def failing_probe(capture_type, definition):
            time.sleep(0.15)
            raise RuntimeProbeError("attach failed")

        with mock.patch.object(
            collector_sidecar, "start_probe", side_effect=failing_probe
        ):
            outcome = collector_sidecar._run_probe_with_heartbeats(
                "req-3", "session-3", "alliance_data", _fake_handler()
            )

        self.assertGreaterEqual(len(self._heartbeats()), 1)
        self.assertEqual(outcome["runtime_error"], "attach failed")

    def test_unexpected_error_propagates(self) -> None:
        with mock.patch.object(
            collector_sidecar, "start_probe", side_effect=ValueError("boom")
        ):
            with self.assertRaises(ValueError):
                collector_sidecar._run_probe_with_heartbeats(
                    "req-4", "session-4", "alliance_data", _fake_handler()
                )


if __name__ == "__main__":
    unittest.main()
