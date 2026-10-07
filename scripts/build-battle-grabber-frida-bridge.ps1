$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AssetsDir = Join-Path $ProjectRoot "src-tauri\assets"
$BridgePy = Join-Path $AssetsDir "frida_bridge.py"

# 依赖目录解析顺序（2026-09-20 修复：此前硬编码 ..\battle_grabber_v4|v5，
# 干净检出必然 `Resolve-Path` 失败；且文档声称支持 *_ROOT 覆盖，代码却没读）。
#   1) 环境变量 BATTLE_GRABBER_V5_ROOT / BATTLE_GRABBER_V4_ROOT
#   2) 仓库内的 legacy 副本 src-tauri\assets\legacy\<name>（默认路径）
#   3) 仓库外的同级目录 ..\<name>（开发机上的原始源码树）
function Resolve-GrabberRoot {
    param(
        [string]$EnvName,
        [string]$Name
    )
    $candidates = @()
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if ($fromEnv) { $candidates += $fromEnv }
    $candidates += (Join-Path $ProjectRoot "src-tauri\assets\legacy\$Name")
    $candidates += (Join-Path $ProjectRoot "..\$Name")
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "config.json")) {
            return (Resolve-Path $candidate)
        }
    }
    throw "找不到 $Name 资源目录。请设置 $EnvName，或确认 src-tauri\assets\legacy\$Name 存在（需含 config.json）。"
}

$V5Root = Resolve-GrabberRoot -EnvName "BATTLE_GRABBER_V5_ROOT" -Name "battle_grabber_v5"
$V4Root = Resolve-GrabberRoot -EnvName "BATTLE_GRABBER_V4_ROOT" -Name "battle_grabber_v4"
$BuildDir = Join-Path $ProjectRoot ".tmp\pyinstaller-build\frida_bridge"
$SpecDir = Join-Path $ProjectRoot ".tmp\pyinstaller-spec"

if (-not (Test-Path $BridgePy)) {
    throw "Bridge script not found: $BridgePy"
}

python -c "import PyInstaller, frida" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller and frida are required. Install with: python -m pip install pyinstaller frida frida-tools"
}

$PyInstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "frida_bridge",
    "--distpath", $AssetsDir,
    "--workpath", $BuildDir,
    "--specpath", $SpecDir,
    "--paths", $V5Root.Path,
    "--paths", $V4Root.Path,
    "--hidden-import", "capture_sync",
    "--hidden-import", "protocol_capture",
    "--hidden-import", "report_renderer",
    "--hidden-import", "frida_client",
    "--hidden-import", "parser",
    "--hidden-import", "reporter",
    "--hidden-import", "alliance_parser",
    "--add-data", "$($AssetsDir)\authoritative_terms.json;.",
    "--add-data", "$($AssetsDir)\frida_passive_battle_capture.js;.",
    "--add-data", "$($AssetsDir)\capture_passive_battle_packets.lua;.",
    "--add-data", "$($V5Root.Path)\config.json;battle_grabber_v5",
    "--add-data", "$($V4Root.Path)\config.json;battle_grabber_v4",
    "--add-data", "$($V4Root.Path)\frida_hook.js;.",
    $BridgePy
)

& python @PyInstallerArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$BridgeExe = Join-Path $AssetsDir "frida_bridge.exe"
if (-not (Test-Path $BridgeExe)) {
    throw "PyInstaller finished but bridge exe is missing: $BridgeExe"
}

Write-Host "Built bridge: $BridgeExe"
