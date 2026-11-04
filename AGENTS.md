# AGENTS.md

Windows-only Tauri v2 app: Rust backend + React 19/TypeScript frontend. A notch/island UI at the top of the screen with an AI assistant (Zara). GPL-3.0-only; see `NOTICE`. Bun is the package manager. CI runs on `windows-latest`.

## Commands

Run from the repo root unless noted. Bun 1.4.x, Rust stable. On this machine the toolchain lives in `Desktop\zara-toolchain` (`RUSTUP_HOME`, `CARGO_HOME`, `BUN_INSTALL`).

- `bun install` — deps (CI uses `bun install --frozen-lockfile`; never create a root `package-lock.json`)
- `bun run tauri dev` — full dev loop. Vite is on strict port 1420; do not start `bun run dev` separately
- `bun run build` — `tsc && vite build`; this is the frontend typecheck. `strict` + `noUnusedLocals`/`noUnusedParameters` fail the build. `bun test` runs the pure-TypeScript tests in `scripts/*.test.ts` (bun:test)
- `cargo check --locked` and `cargo clippy --locked --all-targets` in `src-tauri` — CI's Rust gates
- `cargo test --locked` in `src-tauri` — pure-function unit tests. Runs fast on Windows but CI runs it too
- `bun run bump <x.y.z>` — bumps `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` together
- `bun run release <x.y.z>` — bump + commit + tag + push, must be on `main`. The release workflow fails unless all four version files match the tag. Before/after releasing, follow `RELEASE_CHECKLIST.md` (updater manifest verification, N‑1 install smoke test)

## Architecture

- Three webview windows, each a separate Vite/HTML entry: `main` = notch (`index.html` → `src/main.tsx` → `src/App.tsx`), `overlay` (`overlay.html` → `src/Overlay.tsx`), `settings` (`settings.html` → `src/Settings.tsx`). Adding or renaming a window means editing `src-tauri/tauri.conf.json`, `vite.config.ts` inputs, the HTML file, and `src-tauri/capabilities/default.json`
- Rust entrypoint is `src-tauri/src/main.rs`; `lib.rs` is an empty stub. Every `#[tauri::command]` must be registered in the `generate_handler!` list in `main.rs`
- `commands.rs` = IPC surface; `services.rs` = long-lived Win32 hooks/workers (mouse hook, display monitor, audio visualizer, notch AppBar registration); `utils.rs` = settings cache and file IO; `state.rs`/`types.rs` = shared statics/types
- Backend→frontend events use `app.emit`: `settings-changed`, `settings-external-changed`, `media-update`, `volume-change`, `brightness-change`, `notch-overlap`. Listen via `@tauri-apps/api/event`

## Settings

- Stored in `%APPDATA%/com.zara.app/settings.json` as a flat object of `zara-`-prefixed keys; all values are strings (`"true"`/`"false"` for booleans). `SETTINGS.md` documents every key
- UI write path: set `localStorage`, then `invoke("save_setting")` → backend caches it and emits `settings-changed`. External file edits are watched and emitted as `settings-external-changed`
- `src/hooks/useSettingsSync.ts` is the single sync hook for both events and normalizes string booleans/numbers
- The CSP in `tauri.conf.json` allow-lists network origins (weather APIs only); add new origins there. New Tauri plugins also need permissions in `capabilities/default.json`

## Gotchas

- The app hides the native Windows taskbar and registers AppBars while running. Any new exit/restart path must restore the taskbar and unregister AppBars, like the tray menu in `main.rs` does. A marker file restores it after a crash
- The `windows` crate is pinned to 0.61 with an explicit feature list in `Cargo.toml`; add features there when using new Win32 APIs
- Commits follow conventional commits (`feat:`, `fix:`); release notes are generated from them and commits touching only `website/*`, `.github/*`, or `*.md` are filtered out
