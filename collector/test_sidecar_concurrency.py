from __future__ import annotations

import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collector_sidecar


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


class SidecarConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._env = mock.patch.dict(
            "os.environ", {"SMDC_PROBE_HEARTBEAT_SECONDS": "0.02"}
        )
        self._env.start()
        self.emitted: list[collector_sidecar.SidecarEvent] = []
        self._emit = mock.patch.object(
            collector_sidecar, "emit", side_effect=self.emitted.append
        )
        self._emit.start()
        self._handler = mock.patch.object(
            collector_sidecar,
            "capture_flow_handler",
            return_value=_fake_handler(),
        )
        self._handler.start()
        self._probe_enabled = mock.patch.object(
            collector_sidecar, "runtime_probe_enabled", return_value=True
        )
        self._probe_enabled.start()

    def tearDown(self) -> None:
        self._probe_enabled.stop()
        self._handler.stop()
        self._emit.stop()
        self._env.stop()

    def _feed_stdin(self, lines) -> None:
        patcher = mock.patch.object(
            collector_sidecar.sys, "stdin", _FakeStdin(lines)
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _wait_for(self, predicate, timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return True
            time.sleep(0.01)
        return predicate()

    def _by_request(self, request_id, event_type=None):
        events = [event for event in self.emitted if event.requestId == request_id]
        if event_type is not None:
            events = [event for event in events if event.type == event_type]
        return events

    def _index(self, event) -> int:
        return self.emitted.index(event)

    def test_probe_hang_keeps_command_loop_responsive(self) -> None:
        release = threading.Event()

        def blocked_probe(capture_type, definition):
            release.wait(timeout=5)
            return {"records": 1}

        self._feed_stdin(
            [
                '{"requestId":"req-start","command":"start_capture","payload":{"captureType":"fake"}}',
                '{"requestId":"req-status","command":"status","payload":{}}',
                '{"requestId":"req-second","command":"start_capture","payload":{"captureType":"fake"}}',
                '{"requestId":"req-stop","command":"stop","payload":{}}',
            ]
        )
        try:
            with mock.patch.object(
                collector_sidecar, "start_probe", side_effect=blocked_probe
            ):
                result = collector_sidecar.main()
            self.assertEqual(result, 0)

            # While the first probe is still blocked, the command loop answers
            # status and rejects the second start_capture.
            started = self._by_request("req-start", "capture_started")
            self.assertEqual(len(started), 1)
            status_events = self._by_request("req-status", "status")
            self.assertEqual(len(status_events), 1)
            status_event = status_events[0]
            self.assertEqual(status_event.status, "ready")
            self.assertEqual(
                status_event.payload["supports"], ["status", "start_capture", "stop"]
            )
            second_error = self._by_request("req-second", "error")
            self.assertEqual(len(second_error), 1)
            self.assertEqual(second_error[0].status, "error")
            self.assertEqual(second_error[0].message, "capture already running")
            self.assertEqual(self._by_request("req-second", "capture_started"), [])
            stopped = self._by_request("req-stop", "stopped")
            self.assertEqual(len(stopped), 1)
            self.assertEqual(stopped[0].status, "ok")
            self.assertEqual(stopped[0].message, "collector stopped")

            # The probe is still blocked: no terminal events for req-start yet.
            self.assertEqual(self._by_request("req-start", "capture_result"), [])

            # Heartbeats emitted while blocked must match the original request.
            session_id = started[0].sessionId
            heartbeats = [
                event
                for event in self.emitted
                if event.type == "capture_log"
                and event.payload
                and event.payload.get("heartbeat")
            ]
            for event in heartbeats:
                self.assertEqual(event.requestId, "req-start")
                self.assertEqual(event.sessionId, session_id)

            # Release the probe; the worker then emits capture_log +
            # capture_result for the original request, after the stop event.
            release.set()
            self.assertTrue(
                self._wait_for(
                    lambda: bool(self._by_request("req-start", "capture_result"))
                )
            )
            result_event = self._by_request("req-start", "capture_result")[0]
            self.assertEqual(result_event.status, "completed")
            self.assertEqual(result_event.sessionId, session_id)

            self.assertEqual(self.emitted[0].type, "hello")
            order = [
                self._index(started[0]),
                self._index(status_event),
                self._index(second_error[0]),
                self._index(stopped[0]),
                self._index(result_event),
            ]
            self.assertEqual(order, sorted(order))
        finally:
            release.set()

    def test_single_request_flow_keeps_original_event_order(self) -> None:
        self._feed_stdin(
            [
                '{"requestId":"req-1","command":"start_capture","payload":{"captureType":"fake"}}'
            ]
        )
        with mock.patch.object(
            collector_sidecar, "start_probe", return_value={"records": 0}
        ), mock.patch.object(
            collector_sidecar, "_probe_heartbeat_interval_seconds", return_value=10.0
        ):
            result = collector_sidecar.main()
            self.assertEqual(result, 0)
            self.assertTrue(
                self._wait_for(
                    lambda: bool(self._by_request("req-1", "capture_result"))
                )
            )

        kinds = [event.type for event in self.emitted]
        self.assertEqual(
            kinds, ["hello", "capture_started", "capture_log", "capture_result"]
        )
        by_type = {event.type: event for event in self.emitted}
        self.assertEqual(by_type["capture_started"].requestId, "req-1")
        self.assertEqual(by_type["capture_result"].requestId, "req-1")
        self.assertEqual(
            by_type["capture_started"].sessionId,
            by_type["capture_result"].sessionId,
        )
        self.assertTrue(by_type["capture_started"].sessionId.startswith("runtime-"))
        # The single capture_log is the flow log, not a heartbeat.
        self.assertEqual(by_type["capture_log"].payload, {"nextProbe": "fake"})


if __name__ == "__main__":
    unittest.main()
