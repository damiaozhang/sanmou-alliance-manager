# Third-Party Notices

Sanmou Ledger is distributed under the [MIT License](LICENSE). It bundles or links
against the following third-party components. This list covers the major direct
dependencies; see `package.json`, `src-tauri/Cargo.toml` and the Python imports for
the complete set. Each component remains under its own license.

## Application framework

| Component | License | Project |
|---|---|---|
| Tauri | MIT / Apache-2.0 | https://github.com/tauri-apps/tauri |
| React, React DOM | MIT | https://github.com/facebook/react |
| React Router | MIT | https://github.com/remix-run/react-router |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| TanStack Query / Virtual | MIT | https://github.com/TanStack |
| Vite | MIT | https://github.com/vitejs/vite |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Tailwind CSS | MIT | https://github.com/tailwindlabs/tailwindcss |
| Radix UI | MIT | https://github.com/radix-ui/primitives |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| cmdk | MIT | https://github.com/pacocoursey/cmdk |
| Sonner | MIT | https://github.com/emilkowalski/sonner |
| Apache ECharts | Apache-2.0 | https://github.com/apache/echarts |
| class-variance-authority | Apache-2.0 | https://github.com/joe-bell/cva |
| clsx, tailwind-merge | MIT | https://github.com/lukeed/clsx |

## Rust

| Component | License | Project |
|---|---|---|
| rusqlite / SQLite | MIT (SQLite: public domain) | https://github.com/rusqlite/rusqlite |
| serde / serde_json | MIT / Apache-2.0 | https://github.com/serde-rs |
| chrono | MIT / Apache-2.0 | https://github.com/chronotope/chrono |
| tokio (via Tauri) | MIT | https://github.com/tokio-rs/tokio |
| ts-rs | MIT | https://github.com/Aleph-Alpha/ts-rs |
| rfd | MIT | https://github.com/PolyMeilex/rfd |
| tauri-plugin-updater | MIT / Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| env_logger / log | MIT / Apache-2.0 | https://github.com/rust-lang/log |

## Python / runtime capture

| Component | License | Project |
|---|---|---|
| Frida | LGPL-2.1 (frida-python, frida-core) | https://frida.re |
| PyInstaller | GPL-2.0 **with bootloader exception** | https://pyinstaller.org |

> **Note on Frida.** The optional Frida bridge is built with PyInstaller from
> `src-tauri/assets/frida_bridge.py` and dynamically bundles Frida. Frida is
> licensed under the LGPL-2.1; the bridge is a separate, replaceable component and
> its source is included in this repository. If you redistribute the built
> installer you are responsible for complying with the LGPL. Users who prefer not
> to ship the prebuilt bridge can run the Python fallback instead.

## Game assets and terms

The authority term tables under `src-tauri/assets/authoritative_terms.json` and
`src/battle-grabber/data/authoritativeTerms.json` contain game entity names
(heroes, skills, warbooks, formations, equipment, mounts). These names are the
property of the game's developer/publisher and are included purely for
identification and display purposes.

This project is not affiliated with, endorsed by, or sponsored by the game's
developer or publisher.
