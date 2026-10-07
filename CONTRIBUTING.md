# Contributing to Sanmou Ledger

Thanks for taking the time to contribute. This document covers the local workflow,
the checks a change must pass, and a few project-specific conventions.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and data flow.
- Read [docs/DEV_SETUP.md](docs/DEV_SETUP.md) for environment setup and the
  environment-variable reference.
- Search existing issues before opening a new one.

## Development setup

```bash
npm install
python -m pip install pyinstaller frida
npm run bridge:build     # once: Tauri validates bundle.resources at compile time
npm run tauri dev        # full app (Vite + Rust)
npm run dev              # frontend only, uses mock data
```

Rust lives in `src-tauri/`, the Python collector sidecar in `collector/`.
`npm run bridge:build` is required once before the first Rust compile — see
[Building the Frida bridge](#building-the-frida-bridge).

## Quality gates

Every pull request must pass the same checks CI runs on `windows-latest`:

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
npm run check:version

cd src-tauri
cargo test
cargo clippy

cd ..
python -m unittest discover -s collector -p "test_*.py"
```

Two project-specific guards are worth calling out:

1. **IPC command snapshot.** `src-tauri/src/lib.rs` keeps a `REGISTERED_COMMANDS`
   snapshot that a test compares against the `generate_handler![...]` block. If you
   add, remove or rename a Tauri command you must update the snapshot, or
   `cargo test` fails by design.
2. **ts-rs bindings.** Rust models in `src-tauri/src/models.rs` are the single source
   of truth for IPC types. After changing them, regenerate `src/lib/bindings/` by
   running `cargo test` and commit the diff — CI runs
   `git diff --exit-code -- src/lib/bindings/`.

## Conventions

- **Formatting.** Prettier for `src/**/*.{ts,tsx,css}` (`npm run format`), `cargo fmt`
  for Rust.
- **UI components.** Buttons, inputs and selects are `h-8`; table body text is
  `12.5px` with right-aligned `tabular-nums` numeric columns. Reuse the shared
  `FilterBar` / `TruncatedText` components instead of hand-rolling per page.
- **Dates.** Group by day with `localDateKey(...)` so bucketing follows the local
  timezone, never UTC.
- **Data hygiene.** Never commit a database (`*.db`), capture artifact
  (`runtime-captures/`), real player/alliance name, personal file path, or signing
  key (`temp-keys/`). All of these are git-ignored — please keep it that way.
  Test fixtures must use clearly fictional names.
- **Commits.** Conventional-commit style prefixes (`feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`), scoped where useful, e.g. `fix(collector): ...`.

## Building the Frida bridge

`src-tauri/assets/frida_bridge.exe` is not committed. Build it before packaging:

```bash
python -m pip install pyinstaller frida frida-tools
npm run bridge:build
```

## Reporting bugs

Please include:

- Windows version and app version (Settings → diagnostics).
- The exact steps to reproduce, and what you expected instead.
- Relevant log lines — the sidecar stderr log is written to
  `{app_data}/collector_sidecar.err.log`.

**Do not** attach a real database or raw capture artifact. Redact player names and
alliance tags, or reproduce with synthetic data.
