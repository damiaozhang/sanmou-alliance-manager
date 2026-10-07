# Battle Grabber V6 integration

This project carries an independent copy of the Battle Grabber V6 runtime. The runtime is
fully vendored into this repository (`src/battle-grabber/`, `src-tauri/src/battle_grabber*`,
`src-tauri/assets/`); the original source tree is not required at build time.

## Frontend

- `src/battle-grabber/BattleGrabberApp.tsx` is the V6 React UI adapted from the source app.
- `src/battle-grabber/data/authoritativeTerms.json` is the frontend terms table.
- `src/battle-grabber/styles.css` carries the V6 Tailwind layer.
- `src/App.tsx` exposes the page as `战报提取器 V6` and passes the active Sanmou workspace as the default scan workspace hint.

## Backend

- `src-tauri/src/battle_grabber.rs` is the V6 bridge/session/history runtime ported into this Tauri 2 app.
- `src-tauri/src/battle_grabber_core` keeps the source parser, analyzer, database, command, state, and utility modules as an independent copied V6 data-structure package.
- Commands are registered in `src-tauri/src/lib.rs` alongside the existing workspace, collector, and export commands.
- V6 output defaults to the app data directory under `battle-grabber-v6/output` via `BATTLE_GRABBER_V6_OUTPUT_ROOT`.
- CSV exports created inside the V6 UI are written to the active V6 scan workspace `exports` directory.

## Assets and Scripts

- V6 bridge assets live under `src-tauri/assets`.
- Minimal V4/V5 legacy Python dependencies used by the Python fallback are copied under `src-tauri/assets/legacy`.
- Tauri bundle resources include the V6 bridge executable, Python bridge, Lua/JS hooks, terms table, and legacy directory.
- `scripts/build-battle-grabber-frida-bridge.ps1` rebuilds `frida_bridge.exe` from the local assets and supports `BATTLE_GRABBER_V4_ROOT` / `BATTLE_GRABBER_V5_ROOT` overrides.

## Reference Docs

The original source README, usage docs, standalone batch files, and manual screenshots are copied under this directory for reference.
