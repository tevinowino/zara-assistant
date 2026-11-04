# Zara

An AI assistant that lives in the notch at the top of your Windows screen.

Zara is free software under the GPL-3.0. Licences and credits are in
[NOTICE](NOTICE).

> Status: first complete build. What is and is not finished is in
> [docs/parity.md](docs/parity.md).

## What it does

- **Ask from the notch.** Click the notch (or press your shortcut), type or speak,
  and the answer opens in place with Markdown, math, code and small charts,
  tables, stat cards, carousels and diagrams when they help.
- **Looks at your screen when you ask.** "What does this error say?" makes Zara
  take a screenshot of the monitor you are on and answer from it.
- **Notes and memory.** Zara can add, edit and delete your notes and remember
  lasting facts about you. Everything it does on its own is shown to you, and
  remembered facts have an Undo. Manage it all in Settings > Library.
- **Stealth (optional).** Hides Zara from screen capture and screen sharing.
- **Your shortcuts.** Choose any shortcut; if it can't be used Zara falls back to
  a working one and tells you why.
- **A full notch:** music with a live visualizer, a command
  center (Wi-Fi, Bluetooth, Do Not Disturb, volume, brightness), calendar and
  Pomodoro timer, battery and weather status, connected devices, and a
  drag-and-drop shelf.

## Requirements

- Windows 10 version 2004 (build 19041) or later, or Windows 11, 64-bit
- The WebView2 runtime (included with Windows 11; the installer adds it if missing)
- An API key for an AI service of your choice (OpenRouter, OpenAI, Anthropic, Google, NVIDIA and others), or a local Ollama server, for the assistant. OpenRouter with Google's Gemma model is the default

## Building from source

You need [Rust](https://rustup.rs) (stable, MSVC), the Visual Studio C++ build
tools with a Windows SDK, and [Bun](https://bun.sh).

```powershell
bun install --frozen-lockfile
bun run tauri dev        # run the app (starts the Vite server itself)
bun run build            # typecheck and build the frontend
bun test                 # pure TypeScript tests (scripts/)
bun run test:unit        # component and library tests (src/)
cd src-tauri
cargo test --locked      # backend tests
cargo clippy --locked --all-targets -- -D warnings
```

Do not start `bun run dev` on its own; `tauri dev` starts it. To build an
installer, see [docs/release.md](docs/release.md).

## Privacy

Zara has no telemetry. Your questions, and the screenshots or audio you ask it to
use, go to the AI service you choose (and, for a reseller such as OpenRouter, the company hosting the model) and nowhere else. The full list of network hosts
and where data is stored is in [docs/privacy.md](docs/privacy.md). Your API key
is kept in Windows Credential Manager, not in a file.

## Stealth mode: what it does and does not do

Stealth uses Windows' "exclude from capture" window flag. It hides Zara's windows
from screenshots, recordings and screen sharing tools that honour the flag
(verified against GDI, DXGI Desktop Duplication and Windows Graphics Capture; see
[docs/spikes/stealth.md](docs/spikes/stealth.md)). It does **not** hide the
process from Task Manager, does not stop software from reading the flag, does not
affect a camera pointed at the screen, and does not cover Windows' own tray menu.
It needs Windows 10 version 2004 or later.

## Project layout

| Path | What it is |
|---|---|
| `src/` | The notch, settings and overlay windows (React 19) |
| `src/ai/` | The assistant UI: panel, session state, chat rendering, API wrappers |
| `src-tauri/src/ai/` | The assistant backend: protocol, AI service clients, chat turn, stores, capture |
| `src-tauri/src/stealth.rs` | Capture exclusion |
| `src-tauri/src/shortcuts/` | Shortcut rules and registration |
| `docs/` | Decisions, privacy, parity, release, and the stealth spike |

## License

GPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
