# Feature parity with Electron Zara

Every capability of the old Electron app, and what happened to it. Updated 2026-11-01.

Legend: **Done** works and is tested. **Changed** deliberately different. **Deferred** not built yet. **Dropped** no longer applies.

| Electron Zara | Status | In Zara now |
|---|---|---|
| Chat with Gemini (typed) | Changed | Notch assistant panel; Rust backend (`src-tauri/src/ai`). The model is now chosen by the user, with Gemma through OpenRouter as the default ([ADR 0004](adr/0004-bring-your-own-ai-service.md)) |
| Two-pass context: "look at my screen" | Done | Same text-token protocol, pinned to the original by golden fixtures. Screen is captured with GDI from the monitor under the pointer, shrunk and sent inline |
| Two-pass context: "read my notes" | Done | Same protocol; numbering snapshot taken once per turn |
| Notes the assistant can add, edit and delete | Done | Tags `[[NOTE_ADD]]`, `[[NOTE_EDIT]]`, `[[NOTE_DELETE]]`; capped per reply; changes shown to the user |
| Notes UI | Changed | Library tab in Settings (list, add, edit, delete, colours) instead of a separate dashboard window and compact overlay |
| Memory (durable facts) | Done | `[[REMEMBER]]` tag, de-duplicated, capped, shown with an Undo; manage in Library |
| Conversation history, auto-titles | Done | Saved after each answer, titled from the first exchange; list, open and delete in Library |
| Fresh conversation on launch | Done | A new conversation starts on every launch |
| Markdown, math (KaTeX), code highlighting | Done | Ported and restyled; links open only http(s) and mailto in the system browser |
| Generative widgets (chart, table, stat, carousel, Mermaid) | Done | Contracts and parser ported unchanged with their tests; a test ties the Rust prompt's widget catalogue to them |
| Voice message (microphone) | **Dropped** | Gemma cannot listen to audio, so the microphone button and its code were removed ([ADR 0003](adr/0003-gemma-through-openrouter.md)). Recoverable from git history if an audio model is chosen |
| Voice with system audio ("mic + system") | Deferred | Needs the loopback capture path; not built |
| System-wide dictation (hold a key, text appears in any app) | **Deferred** | Needs a low-level keyboard hook and paste injection. Both can type into the wrong window if wrong, so they need hands-on testing with a person present. See "What is not done" |
| Incognito (hide from screen capture) | Done | Stealth: Settings > Assistant. Every window, verified by reading the flag back; unsupported Windows reported |
| Global shortcuts | Changed | User-assignable with a safe fallback and an explanation; see below |
| Dashboard window | Changed | Replaced by Settings (Assistant and Library tabs) |
| Window move / centre shortcuts | Dropped | The notch has a fixed position |
| API key entry | Done | Onboarding card and Settings; stored in Windows Credential Manager, not in a settings file |
| Model / connection test | Done | Settings > Assistant > Test connection. Settings > Assistant also chooses the service, model and a fallback model ([ADR 0004](adr/0004-bring-your-own-ai-service.md)) |
| Data in `%APPDATA%\zara-ai` | Done | One-click import in Library; copy only, idempotent |
| Streaming replies | Not applicable | The original did not stream either |

## Shortcut actions

| Electron action | Default there | Zara action | Default now |
|---|---|---|---|
| `toggleWindow` | Ctrl+B | `ai.toggle` (global) | Ctrl+Shift+Space |
| `openDashboard` | Ctrl+Shift+O | `ai.settings` (global) | Ctrl+Shift+O |
| `resetConversation` | Ctrl+R | `ai.reset` (panel only) | Ctrl+R |
| `toggleNotes` | Ctrl+N | none | notes live in Settings > Library |
| `toggleDictation` | Ctrl+Shift+D | none yet | deferred with dictation |
| `centerWindow`, `moveWindow*` | various | none | dropped |

The old `shortcuts.json` is not imported: the action names differ, and defaults changed on purpose (global Ctrl+B, Ctrl+R and Ctrl+N would take those keys from every other application).

## What is not done

- **Hold-to-talk dictation into other apps.** Not built, and now also needs an audio-capable model. Beyond transcription it needs a keyboard hook that detects the hold and its release, microphone capture, and a paste into the focused window (with clipboard save and restore, and a fallback for elevated windows). A mistake in the hook or the paste can send keystrokes to the wrong window, so it should be built and tested with someone at the keyboard.
- **System-audio capture** for meetings.
- **Choosing the model** in Settings.
- **Automatic updates and installer signing** (see `docs/release.md`).
