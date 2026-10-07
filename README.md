# Sanmou Ledger

> An **offline** desktop ledger and battle-report manager for the SLG game
> *《三国：谋定天下》* (Three Kingdoms: Strategy for the World — "Sanmou").
> Built with **Tauri 2 + React 18 + Rust + SQLite**.

Sanmou Ledger keeps every capture, roster snapshot, lineup stat and battle report on
**your own machine**. There is no account, no cloud sync, and no telemetry — nothing
is ever uploaded anywhere.

[![CI](https://github.com/damiaozhang/sanmou-alliance-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/damiaozhang/sanmou-alliance-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-blue.svg)](#requirements)

---

## Highlights

- **Fully local.** All data lives in a SQLite database under your Windows app-data
  directory. Export it, back it up, restore it — it never leaves the machine.
- **Alliance ledger.** Member rosters, facility snapshots, alliance logs, supply
  (辎重), member identity binding and an activity-risk view, all scoped per workspace.
- **Battle capture.** A passive Frida-based listener attaches to the game process and
  records alliance battle packets (1004 / 1007 / 1008) without touching game files.
- **Roster & matchup analytics.** Lineup win rates, head-to-head counters, red-tier
  (红度) stratified win rates, and cross-workspace power trends.
- **Time comparison.** Any two historical snapshots can be diffed over an editable
  time window.
- **Four export formats.** Whole-workspace bundles in JSON / CSV / HTML / XLSX.
- **Automatic updates.** Signed NSIS installer + Tauri updater.

## Requirements

| | |
|---|---|
| OS | Windows 10 / 11 (x64) |
| Node.js | 18+ (development) |
| Rust | 1.77+ stable (development) |
| Python | 3.11+ (collector fallback / runtime scan) |

To build the bundled Frida bridge you additionally need `pyinstaller` and `frida`
(see [Building the Frida bridge](#building-the-frida-bridge)).

## Quick start

```bash
npm install
python -m pip install pyinstaller frida   # required once: builds the bundled bridge
npm run bridge:build
npm run tauri dev
```

> `src-tauri/assets/frida_bridge.exe` is not committed (~50 MB). Because Tauri
> validates every `bundle.resources` entry at compile time, `tauri dev`,
> `tauri build` and `cargo test` all fail until `npm run bridge:build` has run
> once — see [Building the Frida bridge](#building-the-frida-bridge).

Only want the UI (mock data, no Rust backend)?

```bash
npm run dev
```

## Build & release

```bash
npm run tauri build          # NSIS installer + updater signature
npm run release:manifest     # generate latest.json for the updater
```

The release pipeline is tag-driven: push a `v*` tag and the `release` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds the installer and
publishes a GitHub Release. See [docs/RELEASE.md](docs/RELEASE.md) for the full
checklist, signing keys and secret names.

### Building the Frida bridge

`src-tauri/assets/frida_bridge.exe` is **not** committed (it is a ~50 MB
PyInstaller one-file bundle). Generate it locally before packaging:

```bash
python -m pip install pyinstaller frida frida-tools
npm run bridge:build
```

The script resolves its V4/V5 dependencies from
`src-tauri/assets/legacy/` by default, or from `BATTLE_GRABBER_V4_ROOT` /
`BATTLE_GRABBER_V5_ROOT` if you have the original source trees checked out.

## Architecture

```
React 18 + TypeScript  ──►  Tauri 2 IPC (49 commands)  ──►  Rust (SQLite / WAL)
                                                                │
                                                   ┌────────────┴────────────┐
                                                   │   Collector sidecar     │
                                                   │  Rust native  / Python  │
                                                   └────────────┬────────────┘
                                                                │ stdio JSONL
                                                   ┌────────────┴────────────┐
                                                   │  Frida runtime scan     │
                                                   │  attach · hooks · dump  │
                                                   └────────────┬────────────┘
                                                                │ attach
                                                       target game process
```

A full breakdown — module map, IPC contract, data flow, and the key design
decisions — is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Project layout

| Path | What lives there |
|---|---|
| `src/` | React frontend (pages, features, feature-scoped hooks, ts-rs bindings) |
| `src-tauri/src/` | Rust backend: Tauri commands, SQLite layer, sidecar supervision, V6 bridge |
| `collector/` | Python collector sidecar, flow handlers, Frida runtime-scan probe |
| `src-tauri/assets/` | Hooks, authority term tables, legacy V4/V5 fallback (bridge exe is built, not committed) |
| `scripts/` | Build, version-check, manifest and smoke-test helpers |
| `docs/` | Architecture, collector protocol, dev setup, release, statistics |

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview, module map, IPC contract, data flow |
| [docs/DEV_SETUP.md](docs/DEV_SETUP.md) | Environment setup, build commands, env-var reference |
| [docs/COLLECTOR_PROTOCOL.md](docs/COLLECTOR_PROTOCOL.md) | stdin/stdout JSON-Lines sidecar protocol |
| [docs/STATISTICS.md](docs/STATISTICS.md) | How battle win rates and lineups are computed |
| [docs/RELEASE.md](docs/RELEASE.md) | Release checklist and updater signing |
| [docs/DESIGN_TONE.md](docs/DESIGN_TONE.md) | UI design tokens and component conventions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute, test, and open a PR |

## Verification

```bash
npx tsc --noEmit          # frontend types
npm run lint              # eslint
npm run test:coverage     # vitest + coverage thresholds
npm run check:version     # version consistency guard

cd src-tauri && cargo test && cargo clippy
```

CI runs all of the above on `windows-latest`, plus a `python -m unittest` pass over
the collector sidecar.

## Privacy

Sanmou Ledger is designed to be data-sovereign:

- No network calls other than the optional update check against this repository's
  GitHub Releases.
- No analytics, no crash reporting, no accounts.
- The SQLite database, capture artifacts and logs stay in your app-data folder and
  are git-ignored by every pattern in `.gitignore`.

## Disclaimer

This is a community project. It is **not** affiliated with, endorsed by, or
sponsored by the game's developer or publisher. All game names, terms and data
are the property of their respective owners. Use at your own risk and in
accordance with the game's terms of service.

## License

[MIT](LICENSE) © Sanmou Ledger contributors.
Bundled third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 中文说明

**Sanmou Ledger** 是一款完全离线的《三国：谋定天下》同盟数据台账与战报管理桌面工具，
技术栈为 Tauri 2 + React 18 + Rust + SQLite。

- **数据不出本机**：所有采集结果、成员快照、阵容统计与战报都存在本机 SQLite 数据库中，
  除可选的版本更新检查外不发起任何网络请求，无账号、无埋点、无上传。
- **核心能力**：同盟台账（成员/设施/日志/辎重/成员绑定）、战报抓取（Frida 被动监听）、
  阵容胜率与克制分析、时间对比、四种格式（JSON/CSV/HTML/XLSX）整包导出。
- **开发**：`npm install` 后执行 `npm run tauri dev`；仅调前端用 `npm run dev`。
- **打包**：先跑 `npm run bridge:build` 生成 `frida_bridge.exe`，再执行 `npm run tauri build`。
- **发布**：推送 `v*` tag 即由 GitHub Actions 自动构建并创建 Release，详见
  [docs/RELEASE.md](docs/RELEASE.md)。

本项目为社区作品，与游戏开发方/发行方无任何关联。
