from __future__ import annotations

import csv
import html
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


TAG_RE = re.compile(r"</?(?:color|link|u)(?:=[^>]*)?>", re.I)
ANY_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class RenderResult:
    txt: Path
    md: Path
    csv: Path
    json: Path | None = None
    html: Path | None = None
    event_count: int = 0


def render_event_file(input_path: Path, output_dir: Path, config: dict[str, Any] | None = None) -> RenderResult:
    config = config or {}
    events = load_events(input_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = input_path.name
    for suffix in (".parsed_events.json", ".events.json", ".json"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break

    rows = normalize_rows(events)
    summary = build_summary(rows)
    max_lines = int(config.get("max_lines", 0) or 0)

    txt = output_dir / f"{stem}.readable.txt"
    md = output_dir / f"{stem}.readable.md"
    csv_path = output_dir / f"{stem}.readable.csv"
    json_path = output_dir / f"{stem}.readable.json"
    html_path = output_dir / f"{stem}.readable.html"

    txt.write_text(build_text_report(input_path, rows, summary, max_lines), encoding="utf-8")
    md.write_text(build_markdown_report(input_path, rows, summary, max_lines), encoding="utf-8")
    write_csv(csv_path, rows)

    final_json_path: Path | None = None
    if config.get("include_raw_json", True):
        json_path.write_text(
            json.dumps(
                {
                    "source": str(input_path),
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                    "event_count": len(rows),
                    "summary": summary,
                    "events": rows,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        final_json_path = json_path

    final_html_path: Path | None = None
    if config.get("include_html", True):
        html_path.write_text(build_html_report(input_path, rows, summary, max_lines), encoding="utf-8")
        final_html_path = html_path

    return RenderResult(
        txt=txt,
        md=md,
        csv=csv_path,
        json=final_json_path,
        html=final_html_path,
        event_count=len(rows),
    )


def load_events(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("events", "data", "eventDataList"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    raise ValueError(f"Unsupported event payload: {path}")


def normalize_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    current_round = 0
    for pos, event in enumerate(events, start=1):
        data = event.get("eventData")
        if not isinstance(data, dict):
            data = {}
        round_value = _to_int(data.get("round"))
        if round_value is not None:
            current_round = round_value
        desc = clean_desc(data.get("finalDesc") or data.get("desc") or event.get("eventName") or "")
        if not desc:
            desc = compact_event_data(event, data)
        row = {
            "seq": int(event.get("index") or pos),
            "eventId": int(event.get("eventId") or 0),
            "eventName": str(event.get("eventName") or ""),
            "tab": int(event.get("tab") or 0),
            "round": current_round,
            "teamId": data.get("teamId", ""),
            "heroId": data.get("heroId", ""),
            "teamId2": data.get("teamId2", ""),
            "heroId2": data.get("heroId2", ""),
            "skillId": data.get("skillId", ""),
            "skillName": data.get("skillName", ""),
            "buffId": data.get("buffId", ""),
            "buffName": data.get("buffName", ""),
            "changeSoldierNum": data.get("changeSoldierNum", ""),
            "resultSoldierNum": data.get("resultSoldierNum", ""),
            "description": desc,
        }
        rows.append(row)
    return rows


def clean_desc(value: Any) -> str:
    text = str(value or "")
    text = TAG_RE.sub("", text)
    text = ANY_TAG_RE.sub("", text)
    text = html.unescape(text)
    text = text.replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def compact_event_data(event: dict[str, Any], data: dict[str, Any]) -> str:
    name = str(event.get("eventName") or f"eventId={event.get('eventId')}")
    if not data:
        return name
    keys = ["teamId", "heroId", "teamId2", "heroId2", "skillId", "buffId", "changeSoldierNum", "resultSoldierNum"]
    parts = [f"{key}={data[key]}" for key in keys if key in data]
    return f"{name} " + " ".join(parts)


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_counter = Counter(str(row["eventId"]) for row in rows)
    skill_counter = Counter(str(row.get("skillName") or row.get("skillId")) for row in rows if row.get("skillName") or row.get("skillId"))
    hero_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"taken": 0, "healed": 0})

    damage_events = 0
    heal_events = 0
    for row in rows:
        change = _to_int(row.get("changeSoldierNum"))
        if change is None or change <= 0:
            continue
        desc = str(row.get("description") or "")
        target = f"{row.get('teamId')}:{row.get('heroId')}"
        if "恢复" in desc or "治疗" in desc:
            heal_events += 1
            hero_stats[target]["healed"] += change
        elif "损失" in desc or "伤害" in desc or int(row.get("eventId") or 0) == 212:
            damage_events += 1
            hero_stats[target]["taken"] += change

    top_taken = sorted(
        (
            {"unit": unit, **stats}
            for unit, stats in hero_stats.items()
            if stats["taken"] or stats["healed"]
        ),
        key=lambda item: (item["taken"], item["healed"]),
        reverse=True,
    )[:12]

    return {
        "event_count": len(rows),
        "round_count": max([int(row.get("round") or 0) for row in rows] or [0]),
        "event_types": event_counter.most_common(20),
        "top_skills": skill_counter.most_common(20),
        "damage_events": damage_events,
        "heal_events": heal_events,
        "top_units": top_taken,
    }


def build_text_report(input_path: Path, rows: list[dict[str, Any]], summary: dict[str, Any], max_lines: int) -> str:
    lines = [
        "=" * 72,
        "  Battle Grabber V5 - official BattleLog readable report",
        f"  Source: {input_path}",
        f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 72,
        "",
        f"Events: {summary['event_count']}    Rounds: {summary['round_count']}    Damage events: {summary['damage_events']}    Heal events: {summary['heal_events']}",
        "",
    ]
    append_summary(lines, summary, markdown=False)
    append_event_lines(lines, rows, max_lines, markdown=False)
    return "\n".join(lines) + "\n"


def build_markdown_report(input_path: Path, rows: list[dict[str, Any]], summary: dict[str, Any], max_lines: int) -> str:
    lines = [
        "# Battle Grabber V5 readable report",
        "",
        f"- Source: `{input_path}`",
        f"- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- Events: {summary['event_count']}",
        f"- Rounds: {summary['round_count']}",
        f"- Damage events: {summary['damage_events']}",
        f"- Heal events: {summary['heal_events']}",
        "",
    ]
    append_summary(lines, summary, markdown=True)
    append_event_lines(lines, rows, max_lines, markdown=True)
    return "\n".join(lines) + "\n"


def append_summary(lines: list[str], summary: dict[str, Any], markdown: bool) -> None:
    title = "## Summary" if markdown else "Summary"
    lines.append(title)
    lines.append("")
    if summary["top_skills"]:
        lines.append("Top skills:")
        for skill, count in summary["top_skills"][:10]:
            lines.append(f"- {skill}: {count}" if markdown else f"  - {skill}: {count}")
        lines.append("")
    if summary["top_units"]:
        lines.append("Top unit soldier changes:")
        for item in summary["top_units"][:10]:
            lines.append(
                f"- {item['unit']}: taken={item['taken']} healed={item['healed']}"
                if markdown
                else f"  - {item['unit']}: taken={item['taken']} healed={item['healed']}"
            )
        lines.append("")


def append_event_lines(lines: list[str], rows: list[dict[str, Any]], max_lines: int, markdown: bool) -> None:
    title = "## Event Flow" if markdown else "Event Flow"
    lines.append(title)
    lines.append("")
    limit = len(rows) if max_lines <= 0 else min(max_lines, len(rows))
    last_round: int | None = None
    for row in rows[:limit]:
        round_value = int(row.get("round") or 0)
        if round_value and round_value != last_round:
            lines.append((f"### Round {round_value}" if markdown else f"-- Round {round_value} --"))
            last_round = round_value
        prefix = f"[{row['seq']:04d} e{row['eventId']} t{row['tab']}]"
        lines.append(f"{prefix} {row['description']}")
    if limit < len(rows):
        lines.append("")
        lines.append(f"... truncated {len(rows) - limit} events by max_lines={max_lines}")


def build_html_report(input_path: Path, rows: list[dict[str, Any]], summary: dict[str, Any], max_lines: int) -> str:
    body = build_markdown_report(input_path, rows, summary, max_lines)
    escaped = html.escape(body)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Battle Grabber V5 Report</title>
  <style>
    body {{ font-family: Consolas, "Microsoft YaHei", sans-serif; margin: 24px; line-height: 1.55; }}
    pre {{ white-space: pre-wrap; word-break: break-word; }}
  </style>
</head>
<body>
<pre>{escaped}</pre>
</body>
</html>
"""


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "seq",
        "eventId",
        "eventName",
        "tab",
        "round",
        "teamId",
        "heroId",
        "teamId2",
        "heroId2",
        "skillId",
        "skillName",
        "buffId",
        "buffName",
        "changeSoldierNum",
        "resultSoldierNum",
        "description",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None

