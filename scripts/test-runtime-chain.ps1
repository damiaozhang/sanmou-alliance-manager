param(
  [int]$WorkspaceId = 3,
  [int]$SessionId = 26,
  [string]$DumpDir = "",
  [string]$RuntimeScanScript = "$PSScriptRoot\..\collector\frida_nslg_runtime_scan.py",
  [string]$RuntimeScanCwd = "$PSScriptRoot\..",
  [switch]$LiveCapture,
  [switch]$NoPreflight,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = "utf-8"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppDataRoot = Join-Path $env:APPDATA "com.sanmou.alliance-manager"
$AppDataSidecar = Join-Path $AppDataRoot "collector_sidecar.py"
$LocalSidecar = Join-Path $RepoRoot "collector\collector_sidecar.py"
$Sidecar = if (Test-Path $AppDataSidecar) { $AppDataSidecar } else { $LocalSidecar }

$env:SMDC_RUNTIME_PROBE = "command"
$env:SMDC_RUNTIME_SCAN_OUT = Join-Path $RepoRoot "runtime-captures"
$env:SMDC_RUNTIME_SCAN_SCRIPT = $RuntimeScanScript
$env:SMDC_RUNTIME_SCAN_CWD = $RuntimeScanCwd
$env:SMDC_RUNTIME_SCAN_MAX_LUA_STRING_BYTES = "33554432"
$env:SMDC_RUNTIME_SCAN_MAX_HOOK_BYTES = "33554432"

Write-Host "== runtime chain test =="
Write-Host "repo: $RepoRoot"
Write-Host "sidecar: $Sidecar"
Write-Host "workspaceId: $WorkspaceId"
Write-Host "sessionId: $SessionId"

if (-not $NoPreflight) {
  Write-Host "`n== preflight =="
  $statusRequest = '{"requestId":"test-preflight","command":"status","payload":{}}'
  $statusRequest | python $Sidecar
}

if ($LiveCapture) {
  Write-Host "`n== live capture =="
  Write-Host "Open alliance member/log/facility screens in the game while this runs."
  $captureRequest = '{"requestId":"test-live-alliance","command":"start_capture","payload":{"captureType":"alliance_data"}}'
  $captureRequest | python $Sidecar
}

Write-Host "`n== offline parser + db check =="
$python = @'
import json
import os
import sqlite3
import sys
from pathlib import Path

repo = Path(sys.argv[1])
workspace_id = int(sys.argv[2])
session_id = int(sys.argv[3])
dump_arg = sys.argv[4].strip()
if dump_arg == "-":
    dump_arg = ""
strict = sys.argv[5].lower() == "true"

sys.path.insert(0, str(repo / "collector"))
from runtime_probe import _read_records_from_directory
from flows.alliance_data import _preview_from_runtime_records

def latest_dump_dir() -> Path | None:
    root = repo / "runtime-captures"
    if not root.exists():
        return None
    dumps = []
    for item in root.glob("alliance_data-*"):
        dump = item / "dump"
        if dump.exists():
            dumps.append(dump)
    if not dumps:
        return None
    return max(dumps, key=lambda path: path.stat().st_mtime)

dump_dir = Path(dump_arg) if dump_arg else latest_dump_dir()
if not dump_dir or not dump_dir.exists():
    raise SystemExit("dump dir not found; pass -DumpDir or run a live capture first")

records = _read_records_from_directory(dump_dir)
preview = _preview_from_runtime_records(records)
parse_summary = {
    "dumpDir": str(dump_dir),
    "recordCount": len(records),
    "memberSnapshots": len(preview.get("memberSnapshots", [])),
    "unionLogs": len(preview.get("unionLogs", [])),
    "buildingSnapshots": len(preview.get("buildingSnapshots", [])),
}
if preview.get("memberSnapshots"):
    first = preview["memberSnapshots"][0]
    parse_summary["firstMember"] = {
        "avatarId": first.get("avatarId"),
        "avatarName": first.get("avatarName"),
        "weeklyContribution": first.get("weeklyContribution"),
        "coordinateX": first.get("coordinateX"),
        "coordinateY": first.get("coordinateY"),
    }
print(json.dumps({"parser": parse_summary}, ensure_ascii=False, indent=2))

db_path = Path(os.environ["APPDATA"]) / "com.sanmou.alliance-manager" / "sanmou-alliance-manager.db"
if not db_path.exists():
    raise SystemExit(f"database not found: {db_path}")

con = sqlite3.connect(db_path)
workspace_counts = {}
for table in ["member_snapshot", "union_log_event", "building_snapshot", "battle_block", "lineup_profile"]:
    workspace_counts[table] = con.execute(
        f"select count(*) from {table} where workspace_id=?",
        (workspace_id,),
    ).fetchone()[0]

session_row = con.execute(
    "select status, summary_json from capture_session where id=?",
    (session_id,),
).fetchone()
session_summary = None
if session_row:
    try:
        summary = json.loads(session_row[1] or "{}")
    except json.JSONDecodeError:
        summary = {}
    runtime = ((summary.get("capture") or {}).get("runtime") or {})
    session_summary = {
        "status": session_row[0],
        "collector": summary.get("collector"),
        "recordCount": runtime.get("recordCount"),
        "previewInsertCounts": summary.get("previewInsertCounts"),
    }

top_members = []
for row in con.execute(
    """
    SELECT avatar_name, official_name, weekly_contribution, coordinate_x, coordinate_y
    FROM (
      SELECT avatar_name, official_name, weekly_contribution, coordinate_x, coordinate_y,
             ROW_NUMBER() OVER (PARTITION BY avatar_id ORDER BY observed_at DESC, id DESC) rn
      FROM member_snapshot
      WHERE workspace_id=?
    )
    WHERE rn = 1
    ORDER BY weekly_contribution DESC, avatar_name ASC
    LIMIT 8
    """,
    (workspace_id,),
):
    top_members.append(
        {
            "avatarName": row[0],
            "officialName": row[1],
            "weeklyContribution": row[2],
            "coord": f"{row[3]},{row[4]}",
        }
    )
con.close()

db_summary = {
    "database": str(db_path),
    "workspaceId": workspace_id,
    "workspaceCounts": workspace_counts,
    "session": session_summary,
    "topMembers": top_members,
}
print(json.dumps({"database": db_summary}, ensure_ascii=False, indent=2))

if strict:
    failures = []
    if parse_summary["recordCount"] <= 0:
        failures.append("parser recordCount is 0")
    if parse_summary["memberSnapshots"] <= 0:
        failures.append("parser memberSnapshots is 0")
    if workspace_counts["member_snapshot"] <= 0:
        failures.append("database member_snapshot is 0")
    if session_summary and (session_summary.get("recordCount") or 0) <= 0:
        failures.append("session runtime recordCount is 0")
    if failures:
        raise SystemExit("STRICT FAIL: " + "; ".join(failures))
print("OK")
'@

$strictValue = if ($Strict) { "true" } else { "false" }
$dumpArg = if ($DumpDir) { $DumpDir } else { "-" }
$TempPy = Join-Path $env:TEMP "sanmou-runtime-chain-test-$PID.py"
try {
  Set-Content -LiteralPath $TempPy -Value $python -Encoding UTF8
  python $TempPy "$RepoRoot" "$WorkspaceId" "$SessionId" "$dumpArg" "$strictValue"
} finally {
  if (Test-Path $TempPy) {
    Remove-Item -LiteralPath $TempPy -Force
  }
}
