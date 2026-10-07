from __future__ import annotations

from dataclasses import dataclass
import importlib
from functools import lru_cache
from typing import Any

from .base import FlowDefinition


def _handler_module_name(flow_name: str, definition: FlowDefinition) -> str:
    handler_name = definition.get("handler")
    if isinstance(handler_name, str) and handler_name:
        return handler_name
    return f"flows.{flow_name}"


@lru_cache(maxsize=None)
def _load_handler(module_name: str):
    return importlib.import_module(module_name)


@dataclass(frozen=True)
class FlowHandlerBundle:
    capture_type: str
    definition: FlowDefinition
    module: Any

    def status_entry(self) -> dict[str, Any]:
        return self.module.status_entry(self.definition, self.capture_type)

    def build_capture_payload(self) -> dict[str, Any]:
        return self.module.build_capture_payload(self.definition, self.capture_type)

    def build_capture_log(
        self, capture_payload: dict[str, Any], session_id: str
    ) -> dict[str, Any] | None:
        return self.module.build_capture_log(
            self.definition, self.capture_type, capture_payload, session_id
        )

    def build_capture_result(
        self, capture_payload: dict[str, Any], session_id: str
    ) -> dict[str, Any]:
        return self.module.build_capture_result(
            self.definition, self.capture_type, capture_payload, session_id
        )

    def capture_log_message(self) -> str:
        return self.module.capture_log_message(self.definition, self.capture_type)


def get_flow_handler(manifest: dict[str, Any], capture_type: str) -> FlowHandlerBundle:
    catalog = manifest.get("captureFlows")
    if not isinstance(catalog, dict):
        raise KeyError(f"unknown capture flow: {capture_type}")

    definition = catalog.get(capture_type)
    if not isinstance(definition, dict):
        raise KeyError(f"unknown capture flow: {capture_type}")

    module_name = _handler_module_name(capture_type, definition)
    return FlowHandlerBundle(
        capture_type=capture_type,
        definition=definition,
        module=_load_handler(module_name),
    )


def load_flow_catalog(manifest: dict[str, Any]) -> dict[str, Any]:
    catalog = manifest.get("captureFlows")
    if not isinstance(catalog, dict):
        return {}

    flow_catalog: dict[str, Any] = {}
    for capture_type, definition in catalog.items():
        if not isinstance(definition, dict):
            continue
        try:
            handler = get_flow_handler(manifest, capture_type)
            flow_catalog[capture_type] = handler.status_entry()
        except Exception as exc:
            flow_catalog[capture_type] = {"error": str(exc)}
    return flow_catalog
