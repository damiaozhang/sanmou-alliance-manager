from __future__ import annotations

from copy import deepcopy
from typing import Any, TypeAlias

FlowDefinition: TypeAlias = dict[str, Any]


def flow_text(definition: FlowDefinition, key: str, fallback: str) -> str:
    value = definition.get(key)
    return value if isinstance(value, str) and value else fallback


def flow_list(definition: FlowDefinition, key: str, fallback: list[str]) -> list[str]:
    value = definition.get(key)
    if isinstance(value, list):
        items = [item for item in value if isinstance(item, str) and item]
        if items:
            return items
    return list(fallback)


def flow_preview(definition: FlowDefinition) -> dict[str, Any]:
    value = definition.get("preview")
    return deepcopy(value) if isinstance(value, dict) else {}

