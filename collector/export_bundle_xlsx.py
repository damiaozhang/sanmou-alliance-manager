#!/usr/bin/env python3
"""Write the workspace bundle export as a single XLSX workbook."""

from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"


def read_bundle() -> dict[str, Any]:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid bundle JSON on stdin: {exc}") from exc


def col_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def sheet_data(headers: list[str], rows: list[list[Any]]) -> tuple[str, list[int]]:
    width_count = max(len(headers), max((len(row) for row in rows), default=0))
    widths = [len(str(header)) for header in headers] + [0] * max(0, width_count - len(headers))

    def render_cell(ref: str, value: Any, header: bool = False) -> str:
        style = ' s="1"' if header else ""
        if value is None:
            return f'<c r="{ref}"{style}/>'
        if isinstance(value, bool):
            return f'<c r="{ref}" t="b"{style}><v>{1 if value else 0}</v></c>'
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{ref}"{style}><v>{value}</v></c>'
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value))
        text = escape(text, {"'": "&apos;"})
        return f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{text}</t></is></c>'

    xml_rows = []
    all_rows = [headers] + rows
    for row_index, row in enumerate(all_rows, start=1):
        cells = []
        for col_index, value in enumerate(row, start=1):
            width_text = "" if value is None else str(value)
            widths[col_index - 1] = max(widths[col_index - 1], min(len(width_text), 60))
            cells.append(render_cell(f"{col_name(col_index)}{row_index}", value, header=row_index == 1))
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    dimension = f"A1:{col_name(max(1, len(headers)))}{max(1, len(all_rows))}"
    cols_xml = "".join(
        f'<col min="{idx}" max="{idx}" width="{min(width + 2, 60)}" customWidth="1"/>'
        for idx, width in enumerate(widths, start=1)
        if width > 0
    )
    sheet_xml = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{XML_NS}" xmlns:r="{REL_NS}">'
        f'<dimension ref="{dimension}"/>'
        f'<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>'
        f'<sheetFormatPr defaultRowHeight="15"/>'
        f'<cols>{cols_xml}</cols>'
        f'<sheetData>{"".join(xml_rows)}</sheetData>'
        f'<autoFilter ref="{dimension}"/>'
        f'</worksheet>'
    )
    return sheet_xml, widths


def summary_rows(bundle: dict[str, Any]) -> list[list[Any]]:
    summary = bundle.get("summary", {})
    exported_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    rows = [["exportedAt", exported_at]]
    for key, value in summary.items():
        rows.append([key, value])
    return rows


def sheet_specs(bundle: dict[str, Any]) -> list[tuple[str, list[str], list[list[Any]]]]:
    return [
        (
            "概览",
            ["key", "value"],
            summary_rows(bundle),
        ),
        (
            "成员",
            ["name", "official", "contribution", "merit", "demolition", "coord", "status", "lastOfflineTs"],
            [
                [
                    row.get("name", ""),
                    row.get("official", ""),
                    row.get("contribution", ""),
                    row.get("merit", ""),
                    row.get("demolition", ""),
                    row.get("coord", ""),
                    row.get("status", ""),
                    row.get("lastOfflineTs", ""),
                ]
                for row in bundle.get("allianceMembers", [])
            ],
        ),
        (
            "日志",
            ["time", "category", "actor", "target", "text"],
            [
                [
                    row.get("time", ""),
                    row.get("category", ""),
                    row.get("actor", ""),
                    row.get("target", ""),
                    row.get("text", ""),
                ]
                for row in bundle.get("allianceLogs", [])
            ],
        ),
        (
            "设施",
            ["name", "level", "state", "effect"],
            [
                [
                    row.get("name", ""),
                    row.get("level", ""),
                    row.get("state", ""),
                    row.get("effect", ""),
                ]
                for row in bundle.get("allianceFacilities", [])
            ],
        ),
        (
            "成员快照",
            [
                "id",
                "captureSessionId",
                "observedAt",
                "avatarId",
                "avatarName",
                "officialName",
                "state",
                "weeklyContribution",
                "weeklyMerit",
                "seasonScore",
                "demolitionValue",
                "coordinateX",
                "coordinateY",
                "lastOfflineTs",
                "joinTs",
                "tFeat",
                "tForageUse",
                "wForageUse",
                "weeklyStatisticsJson",
                "rawJson",
            ],
            [
                [
                    row.get("id", ""),
                    row.get("captureSessionId", ""),
                    row.get("observedAt", ""),
                    row.get("avatarId", ""),
                    row.get("avatarName", ""),
                    row.get("officialName", ""),
                    row.get("state", ""),
                    row.get("weeklyContribution", ""),
                    row.get("weeklyMerit", ""),
                    row.get("seasonScore", ""),
                    row.get("demolitionValue", ""),
                    row.get("coordinateX", ""),
                    row.get("coordinateY", ""),
                    row.get("lastOfflineTs", ""),
                    row.get("joinTs", ""),
                    row.get("tFeat", ""),
                    row.get("tForageUse", ""),
                    row.get("wForageUse", ""),
                    row.get("weeklyStatisticsJson", ""),
                    row.get("rawJson", ""),
                ]
                for row in bundle.get("memberSnapshots", [])
            ],
        ),
        (
            "设施快照",
            [
                "id",
                "captureSessionId",
                "observedAt",
                "buildingName",
                "level",
                "state",
                "effect",
                "rawJson",
            ],
            [
                [
                    row.get("id", ""),
                    row.get("captureSessionId", ""),
                    row.get("observedAt", ""),
                    row.get("buildingName", ""),
                    row.get("level", ""),
                    row.get("state", ""),
                    row.get("effect", ""),
                    row.get("rawJson", ""),
                ]
                for row in bundle.get("buildingSnapshots", [])
            ],
        ),
        (
            "战报",
            ["time", "battleCode", "enemy", "enemyPlayer", "result", "round", "location", "lineup", "battleId", "battlefieldEnvironmentJson"],
            [
                [
                    row.get("time", ""),
                    row.get("battleCode", ""),
                    row.get("enemy", ""),
                    row.get("enemyPlayer", ""),
                    row.get("result", ""),
                    row.get("round", ""),
                    row.get("location", ""),
                    row.get("lineup", ""),
                    row.get("battleId", ""),
                    row.get("battlefieldEnvironmentJson", ""),
                ]
                for row in bundle.get("battleReports", [])
            ],
        ),
        (
            "阵容",
            ["label", "player", "heroes", "source", "confidence"],
            [
                [
                    row.get("label", ""),
                    row.get("player", ""),
                    row.get("heroes", ""),
                    row.get("source", ""),
                    row.get("confidence", ""),
                ]
                for row in bundle.get("lineupProfiles", [])
            ],
        ),
        (
            "绑定",
            ["name", "avatar", "alliance", "status", "updated"],
            [
                [
                    row.get("name", ""),
                    row.get("avatar", ""),
                    row.get("alliance", ""),
                    row.get("status", ""),
                    row.get("updated", ""),
                ]
                for row in bundle.get("memberBindings", [])
            ],
        ),
        (
            "会话",
            ["id", "captureType", "status", "startedAt", "finishedAt", "summaryJson"],
            [
                [
                    row.get("id", ""),
                    row.get("captureType", ""),
                    row.get("status", ""),
                    row.get("startedAt", ""),
                    row.get("finishedAt", ""),
                    row.get("summaryJson", ""),
                ]
                for row in bundle.get("captureSessions", [])
            ],
        ),
        (
            "原始证据",
            [
                "id",
                "captureSessionId",
                "artifactType",
                "path",
                "sourceModule",
                "sourceFunc",
                "capturedAt",
                "sha256",
                "sensitiveScanStatus",
            ],
            [
                [
                    row.get("id", ""),
                    row.get("captureSessionId", ""),
                    row.get("artifactType", ""),
                    row.get("path", ""),
                    row.get("sourceModule", ""),
                    row.get("sourceFunc", ""),
                    row.get("capturedAt", ""),
                    row.get("sha256", ""),
                    row.get("sensitiveScanStatus", ""),
                ]
                for row in bundle.get("rawArtifacts", [])
            ],
        ),
    ]


def workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{idx}" r:id="rId{idx}"/>'
        for idx, name in enumerate(sheet_names, start=1)
    )
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="{XML_NS}" xmlns:r="{REL_NS}"><sheets>{sheets}</sheets></workbook>'
    )


def workbook_rels_xml(sheet_count: int) -> str:
    rels = "".join(
        f'<Relationship Id="rId{idx}" Type="{REL_NS}/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        for idx in range(1, sheet_count + 1)
    )
    rels += (
        f'<Relationship Id="rId{sheet_count + 1}" '
        f'Type="{REL_NS}/styles" Target="styles.xml"/>'
    )
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{PKG_REL_NS}">{rels}</Relationships>'
    )


def root_rels_xml() -> str:
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{PKG_REL_NS}">'
        f'<Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="xl/workbook.xml"/>'
        f'<Relationship Id="rId2" Type="{PKG_REL_NS}/metadata/core-properties" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{PKG_REL_NS}/extended-properties" Target="docProps/app.xml"/>'
        f'</Relationships>'
    )


def styles_xml() -> str:
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<styleSheet xmlns="{XML_NS}">'
        f'<fonts count="2">'
        f'<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        f'<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
        f'</fonts>'
        f'<fills count="2">'
        f'<fill><patternFill patternType="none"/></fill>'
        f'<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>'
        f'</fills>'
        f'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        f'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        f'<cellXfs count="2">'
        f'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        f'<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">'
        f'<alignment vertical="center"/>'
        f'</xf>'
        f'</cellXfs>'
        f'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        f'</styleSheet>'
    )


def core_props_xml() -> str:
    created = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<cp:coreProperties '
        f'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        f'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        f'xmlns:dcterms="http://purl.org/dc/terms/" '
        f'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        f'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f'<dc:title>Workspace Bundle Export</dc:title>'
        f'<dc:creator>Sanmou Alliance Manager</dc:creator>'
        f'<cp:lastModifiedBy>Sanmou Alliance Manager</cp:lastModifiedBy>'
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>'
        f'</cp:coreProperties>'
    )


def app_props_xml(sheet_names: list[str]) -> str:
    titles = "".join(f"<vt:lpstr>{escape(name)}</vt:lpstr>" for name in sheet_names)
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        f'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        f"<Application>Sanmou Alliance Manager</Application>"
        f"<HeadingPairs><vt:vector size=\"2\" baseType=\"variant\">"
        f"<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>"
        f"<vt:variant><vt:i4>{len(sheet_names)}</vt:i4></vt:variant>"
        f"</vt:vector></HeadingPairs>"
        f"<TitlesOfParts><vt:vector size=\"{len(sheet_names)}\" baseType=\"lpstr\">{titles}</vt:vector></TitlesOfParts>"
        f"</Properties>"
    )


def content_types_xml(sheet_count: int) -> str:
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{idx}.xml" '
        f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for idx in range(1, sheet_count + 1)
    )
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{CONTENT_TYPES_NS}">'
        f'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        f'<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        f'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        f'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        f"{overrides}"
        f'</Types>'
    )


def main() -> int:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        raise SystemExit("usage: export_bundle_xlsx.py OUTPUT_PATH")

    output_path = Path(sys.argv[1]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    bundle = read_bundle()
    specs = sheet_specs(bundle)
    sheet_names = [name for name, _, _ in specs]

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml(len(specs)))
        archive.writestr("_rels/.rels", root_rels_xml())
        archive.writestr("docProps/core.xml", core_props_xml())
        archive.writestr("docProps/app.xml", app_props_xml(sheet_names))
        archive.writestr("xl/workbook.xml", workbook_xml(sheet_names))
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(len(specs)))
        archive.writestr("xl/styles.xml", styles_xml())

        for idx, (sheet_name, headers, rows) in enumerate(specs, start=1):
            sheet_xml, _ = sheet_data(headers, rows)
            archive.writestr(f"xl/worksheets/sheet{idx}.xml", sheet_xml)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
