# Spike: hiding Zara from screen capture (Phase 1)

Run 2026-10-31 on Windows 11 build 26300, single GPU, primary monitor at the virtual-screen origin.

## Question

Can a topmost, transparent-capable window be excluded from screen capture and sharing, so the notch is invisible to anyone watching a shared screen or recording?

## What Tauri does

`tao 0.35.3` (in `Cargo.lock`) implements `set_content_protection` with `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` when enabled and `WDA_NONE` when disabled
(`tao-0.35.3/src/platform_impl/windows/window.rs`, around line 1090). It **ignores the Win32 result** (`let _ = ...`), so Zara must read the affinity back with `GetWindowDisplayAffinity` rather than trust the call.

## Method

`docs/spikes/stealth-probe/` is a standalone Rust program (not part of the app build). It creates a solid-magenta topmost window (once plain, once `WS_EX_LAYERED` like the notch), sets each display affinity in turn, and reads back the screen pixel behind the window's centre through three independent capture paths:

1. GDI `BitBlt` of the screen with `CAPTUREBLT`
2. DXGI Desktop Duplication (used by OBS display capture and many screen-sharing tools)
3. Windows Graphics Capture (used by Snipping Tool, Game Bar, Teams, Zoom, browsers' screen share)

Magenta means the window leaked into the capture. The desktop colour means it was hidden.

## Results

| Window | Affinity | GDI | DXGI | WGC | Read-back |
|---|---|---|---|---|---|
| plain | NONE | leaked | leaked | leaked | 0x0 |
| plain | EXCLUDE (0x11) | hidden | hidden | hidden | 0x11 |
| plain | MONITOR (0x1) | hidden | hidden | hidden | 0x1 |
| layered | NONE | leaked | leaked | leaked | 0x0 |
| layered | EXCLUDE (0x11) | hidden | hidden | hidden | 0x11 |
| layered | MONITOR (0x1) | hidden | hidden | hidden | 0x1 |

- With `EXCLUDE`, captures show what is **behind** the window, not a black rectangle.
- Applying the flag works on a layered window, which is what a transparent webview window is.
- The first version of the probe reported black for every DXGI row, including the no-protection row. That was a bug in the probe (wrong output, frames without desktop pixels), not a result, and it is fixed. The numbers above come from the corrected probe.

## Conclusions

- Decision: use `WDA_EXCLUDEFROMCAPTURE` via Tauri's `set_content_protected`. Never use `WDA_MONITOR` (on older Windows builds it paints a black rectangle).
- Read the flag back after applying it and treat a mismatch as a failure.
- Gate G1 passes on programmatic evidence for the three capture APIs used by almost all tools.

## Not covered by this spike (carry into Phase 7)

- The real notch is a **WebView2** child inside a Tauri window. The flag is set on the top-level window, so it should behave like the layered probe, but this must be re-verified against the shipped app (Phase 7 does this with an in-app self-check).
- Specific apps (Snipping Tool, Game Bar, OBS, Teams, Zoom, Meet) were not driven by hand. Their capture paths are the three tested here, so they are expected to behave the same; add a manual pass to the release checklist.
- Windows 10 builds before 19041 do not support `WDA_EXCLUDEFROMCAPTURE`; the product must detect that and report "unsupported" instead of applying the flag.
- Native popups (tray menu, message boxes, file dialogs) are separate windows and are **not** covered by the flag on the main window.
- Remote Desktop sessions, virtual displays and hardware capture were not tested. A camera pointed at the screen cannot be affected.
- The window and process remain visible to software that enumerates windows or reads the affinity flag. "Hidden" means hidden from screen capture and sharing only.
