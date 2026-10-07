param(
  [int]$WorkspaceId = 3,
  [int]$WatchSeconds = 180,
  [int]$PollSeconds = 5,
  [string]$ExePath = "",
  [string]$RuntimeScanScript = "$PSScriptRoot\..\collector\frida_nslg_runtime_scan.py",
  [string]$RuntimeScanCwd = "$PSScriptRoot\..",
  [switch]$UseTauriDev,
  [switch]$NoLaunch,
  [switch]$NoSyncCollector
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = "utf-8"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppDataRoot = Join-Path $env:APPDATA "com.sanmou.alliance-manager"
$AppDataFlows = Join-Path $AppDataRoot "flows"
$AppDataSidecar = Join-Path $AppDataRoot "collector_sidecar.py"
$DbPath = Join-Path $AppDataRoot "sanmou-alliance-manager.db"

$env:SMDC_RUNTIME_PROBE = "command"
$env:SMDC_RUNTIME_SCAN_OUT = Join-Path $RepoRoot "runtime-captures"
$env:SMDC_RUNTIME_SCAN_SCRIPT = $RuntimeScanScript
$env:SMDC_RUNTIME_SCAN_CWD = $RuntimeScanCwd
$env:SMDC_RUNTIME_SCAN_MAX_LUA_STRING_BYTES = "33554432"
$env:SMDC_RUNTIME_SCAN_MAX_HOOK_BYTES = "33554432"

if (-not $NoSyncCollector) {
  New-Item -ItemType Directory -Force -Path $AppDataRoot, $AppDataFlows | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\collector_manifest.json") -Destination (Join-Path $AppDataRoot "collector_manifest.json") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\collector_sidecar.py") -Destination (Join-Path $AppDataRoot "collector_sidecar.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\runtime_probe.py") -Destination (Join-Path $AppDataRoot "runtime_probe.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\flows\__init__.py") -Destination (Join-Path $AppDataFlows "__init__.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\flows\base.py") -Destination (Join-Path $AppDataFlows "base.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\flows\registry.py") -Destination (Join-Path $AppDataFlows "registry.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\flows\alliance_data.py") -Destination (Join-Path $AppDataFlows "alliance_data.py") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "collector\flows\battle_passive.py") -Destination (Join-Path $AppDataFlows "battle_passive.py") -Force
  python -m py_compile `
    (Join-Path $AppDataRoot "runtime_probe.py") `
    (Join-Path $AppDataRoot "collector_sidecar.py") `
    (Join-Path $AppDataFlows "alliance_data.py") `
    (Join-Path $AppDataFlows "battle_passive.py")
}

if (-not $ExePath -and -not $UseTauriDev) {
  $DebugExe = Join-Path $RepoRoot "src-tauri\target\debug\sanmou-alliance-manager.exe"
  $ReleaseExe = Join-Path $RepoRoot "src-tauri\target\release\sanmou-alliance-manager.exe"
  if (Test-Path $DebugExe) {
    $ExePath = $DebugExe
  } elseif (Test-Path $ReleaseExe) {
    $ExePath = $ReleaseExe
  } else {
    throw "Desktop exe not found. Build first: cargo build --manifest-path src-tauri\Cargo.toml"
  }
}

Write-Host "== desktop app test =="
Write-Host "repo: $RepoRoot"
Write-Host "appData: $AppDataRoot"
Write-Host "db: $DbPath"
if ($UseTauriDev) {
  Write-Host "launcher: npm.cmd run tauri dev"
} else {
  Write-Host "exe: $ExePath"
}
Write-Host "workspaceId: $WorkspaceId"

$preflightPy = @'
import json
import os
import subprocess
import sys

sidecar = sys.argv[1]
request = '{"requestId":"desktop-preflight","command":"status","payload":{}}\n'
proc = subprocess.run(
    [sys.executable, sidecar],
    input=request,
    text=True,
    encoding="utf-8",
    errors="replace",
    capture_output=True,
    timeout=20,
)
status = None
for line in proc.stdout.splitlines():
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    if event.get("type") == "status":
        status = event
if not status:
    print(json.dumps({"preflight": {"ok": False, "stderr": proc.stderr[-800:]}}, ensure_ascii=False, indent=2))
    raise SystemExit(1)
payload = status.get("payload") or {}
probe = payload.get("runtimeProbe") or {}
flows = payload.get("captureFlows") or {}
alliance = flows.get("alliance_data") or {}
print(json.dumps({
    "preflight": {
        "ok": status.get("status") == "ready",
        "mode": payload.get("mode"),
        "manifestSource": payload.get("manifestSource"),
        "processFound": probe.get("processFound"),
        "processTarget": probe.get("processTarget"),
        "fridaAvailable": probe.get("fridaAvailable"),
        "scriptExists": probe.get("scriptExists"),
        "issues": probe.get("issues"),
        "nextProbe": alliance.get("nextProbe"),
    }
}, ensure_ascii=False, indent=2))
'@

$watchPy = @'
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

db_path = Path(sys.argv[1])
workspace_id = int(sys.argv[2])
watch_seconds = int(sys.argv[3])
poll_seconds = max(1, int(sys.argv[4]))

deadline = time.time() + watch_seconds
last_signature = None
print("watching database; click capture in the desktop app now")
while time.time() <= deadline:
    if not db_path.exists():
        print(f"{datetime.now().strftime('%H:%M:%S')} db missing: {db_path}")
        time.sleep(poll_seconds)
        continue
    con = sqlite3.connect(db_path)
    counts = {}
    for table in ["member_snapshot", "union_log_event", "building_snapshot", "battle_block", "lineup_profile"]:
        counts[table] = con.execute(
            f"select count(*) from {table} where workspace_id=?",
            (workspace_id,),
        ).fetchone()[0]
    latest = con.execute(
        "select id, status, summary_json from capture_session where workspace_id=? and capture_type='alliance_data' order by id desc limit 1",
        (workspace_id,),
    ).fetchone()
    latest_runtime = con.execute(
        "select id, status, summary_json from capture_session where workspace_id=? and capture_type='alliance_data' and summary_json like '%runtime_probe%' order by id desc limit 1",
        (workspace_id,),
    ).fetchone()
    top_members = [
        row[0]
        for row in con.execute(
            """
            SELECT avatar_name
            FROM (
              SELECT avatar_name,
                     ROW_NUMBER() OVER (PARTITION BY avatar_id ORDER BY observed_at DESC, id DESC) rn,
                     weekly_contribution
              FROM member_snapshot
              WHERE workspace_id=?
            )
            WHERE rn = 1
            ORDER BY weekly_contribution DESC, avatar_name ASC
            LIMIT 5
            """,
            (workspace_id,),
        )
    ]
    con.close()

    def summarize_session(row):
        if not row:
            return None
        try:
            summary = json.loads(row[2] or "{}")
        except json.JSONDecodeError:
            summary = {}
        runtime = ((summary.get("capture") or {}).get("runtime") or {})
        return {
            "id": row[0],
            "status": row[1],
            "collector": summary.get("collector"),
            "recordCount": runtime.get("recordCount"),
            "previewInsertCounts": summary.get("previewInsertCounts"),
        }

    snapshot = {
        "time": datetime.now().strftime("%H:%M:%S"),
        "counts": counts,
        "latest": summarize_session(latest),
        "latestRuntime": summarize_session(latest_runtime),
        "topMembers": top_members,
    }
    signature = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
    if signature != last_signature:
        print(json.dumps(snapshot, ensure_ascii=False))
        last_signature = signature
    time.sleep(poll_seconds)
print("watch finished")
'@

$TempPreflight = Join-Path $env:TEMP "sanmou-desktop-preflight-$PID.py"
$TempWatch = Join-Path $env:TEMP "sanmou-desktop-watch-$PID.py"
try {
  Set-Content -LiteralPath $TempPreflight -Value $preflightPy -Encoding UTF8
  Set-Content -LiteralPath $TempWatch -Value $watchPy -Encoding UTF8
  python $TempPreflight $AppDataSidecar

  if (-not $NoLaunch) {
    Write-Host "`n== launching desktop =="
    if ($UseTauriDev) {
      Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "tauri", "dev") -WorkingDirectory $RepoRoot -WindowStyle Hidden
    } else {
      Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path $ExePath -Parent)
    }
    Write-Host "Desktop launched. In the app: select workspace 3, open Capture, click alliance capture."
  }

  Write-Host "`n== db watcher =="
  python $TempWatch $DbPath "$WorkspaceId" "$WatchSeconds" "$PollSeconds"
} finally {
  if (Test-Path $TempPreflight) { Remove-Item -LiteralPath $TempPreflight -Force }
  if (Test-Path $TempWatch) { Remove-Item -LiteralPath $TempWatch -Force }
}
