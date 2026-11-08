# Plan: more widgets (Claude Code activity, music lyrics)

Date: 2026-11-08. Status: **built on branch `feat/widgets-platform`; see Status below.** What was planned is kept as written, with corrections where the spikes showed the plan wrong.

## Status (2026-11-08)

Built, with tests (frontend 1,713, Rust 655, repo guard tests 65; `tsc`, `vite build`, `clippy --locked --all-targets` clean):

| Phase | Done |
|---|---|
| 1 Widget registry | Notes, Clipboard and Weather draw through `WIDGET_VIEWS` (`src/notch/widgets/`); `NotchPanel` and the picker icons derive from the definitions. Adding a widget is now one definition plus one registry entry |
| M Music card | `"card"` is a third layout (`MusicCard`, `MusicCardView`, `mediaLayouts.ts`); shared `usePlaybackClock`; the glow takes its colors from the cover (`extractGlowPalette`). Checked in headless Chrome on a red/purple, a bright and a green cover |
| 2 Notch notifications | `notifications.rs` reads the Action Center; the pill, queue, per-app allowing, text hiding and Settings section are in. Off by default |
| 3 Lyrics | `lyrics.rs` (LRCLIB, cache, `.lrc` parser, title cleaning) and a Lyrics widget: highlighted line, timing +/- buttons, save a line to Notes, ask Zara about it |
| 4 Claude Code | `claude_code.rs` (hook script, spool reader, session board, safe `settings.json` editing), a widget, a Settings section with a preview-and-agree connect step, and pill alerts |

### What the spikes found

- **S4, reading Windows notifications from an unpackaged app: works.** `RequestAccessAsync` returned Allowed for a plain unpackaged program; a test toast was seen by polling within about a second. `NotificationChanged` fails to subscribe (0x80070490), as the crate report said, so Zara polls. No installer or packaging change is needed. Option B and C (sparse package, MSIX) are not needed.
- **S2, LRCLIB:** `/api/get` answers with `trackName`, `artistName`, `duration` (seconds), `instrumental`, `plainLyrics`, `syncedLyrics` (`[mm:ss.xx]`), and a 404 for an unknown track; `/api/search` returns an array. Checked with two public songs. A hit rate over your own library and players has **not** been measured.
- **S1, Claude Code hooks:** run with Claude Code 2.1.309 on this machine (`claude -p` with a temporary `--settings` file). The PowerShell hook command runs as Claude Code launches it, and `SessionStart`, `UserPromptSubmit` and `SessionEnd` arrived with the expected fields. `Stop` arrives with `last_assistant_message` when the hook is synchronous; as an `async` hook it is killed at exit in print mode (the docs say so), which does not apply to an interactive session. The VS Code extension fires `SessionStart` and `UserPromptSubmit` (this very session shows them); whether it fires `Stop` and `Notification` is **still untested**.
- **S3, playhead accuracy per player:** not measured. The lyrics timing buttons are the answer if a player runs early or late.

### Corrections to the plan above

- **Stealth.** Stealth excludes Zara's windows from screen capture, so the pill is not captured while it holds. The rule that matters is the opposite one, and it is built: when Stealth is switched on but is **not** holding, the pill (and Claude Code alerts) hide the text.
- **Hook file.** The plan said the file would be appended with a normal PowerShell cmdlet. The first real run showed it writes a byte-order mark, so the script appends with .NET (no mark) and the reader also strips one.
- **Key order.** Re-writing Claude Code's `settings.json` would have sorted its keys. `serde_json`'s `preserve_order` is now on, so the file keeps its order; a test pins it.
- **Lyrics pill ticker** (the current line in the collapsed pill) was **not** built: the pill is about 140 px wide and this needs a look at the real notch. The panel, the line highlight, Save to Notes and Ask Zara are built.
- **`Notification` events.** `permission_prompt` and `elicitation_dialog` count as "needs you". `idle_prompt` does not alert (it follows a finished turn).

### Not tested

- Nothing here has been run inside the full Tauri app. The pill, the card, the Lyrics and Claude Code widgets and the Settings sections are covered by component and unit tests and (for the card) a browser preview, not by launching Zara.
- A real Windows toast through the app's reader to the pill; an interactive Claude Code session (CLI or extension) through to a pill.
- The music card's blur and glow on the real notch window, and its cost while opening (use `localStorage["zara-frame-probe"]="1"`).

### Still open from the decisions list

- Lyrics source and licence comfort (see Phase 3).
- Whether to move device alerts onto the notification channel.
- User-installable widgets: not started; the registry does not rule it out.

## The goal

1. Adding a widget becomes **one folder and one registry line**, not edits scattered through `App.tsx`.
2. **Notch notifications**: when a notification appears on the laptop, the notch pops out as a pill and shows it, like a Dynamic Island. One pill, fed by more than one source.
3. **Music card**: redesign the music view as a full-bleed album-art card with music and volume controls and a glow that matches the cover (Phase M).
4. Two widgets prove the platform:
   - **Claude Code**: see what your Claude Code sessions are doing; "needs you" and "finished" arrive as notch notifications.
   - **Lyrics**: the line of the song that is playing, in sync, in the notch.

## What exists today

The notch has two kinds of content (`src/notch/types.ts`):

- **Panels**: tools the user picks in Settings, cycled with arrows or wheel. Defined in `NOTCH_PANEL_DEFINITIONS` (`src/notch/panels/notchPanels.ts`). Today: assistant, calendar, command center, devices, notes, clipboard, weather.
- **Live activities**: music, timer, shelf, device alerts. They show in the collapsed pill or a bubble, and each has its own hand-written rule in `App.tsx` (`collapsedMode`, `showMusicBubble`, `useDeviceAlerts`).

`notchPanels.ts` says "adding a widget is one entry, a view and its size". That is no longer true. The Notes, Clipboard and Weather widgets each needed edits in all of these places:

| # | Place | What it does for a widget |
|---|---|---|
| 1 | `notchPanels.ts` `NotchPanel` union and `NOTCH_PANEL_DEFINITIONS` | identity, label, default |
| 2 | `notch/types.ts` `ZaraMode` union | the mode string |
| 3 | `WidgetPicker.tsx` `PANEL_ICONS` | icon |
| 4 | `App.tsx` `collapseNotch` (about line 606-621) | list of modes that collapse back to resting |
| 5 | `App.tsx` `handleWheel` (about line 650-658) | CSS selector so the widget can scroll without cycling panels |
| 6 | `App.tsx` `getDynamicWidth` / `getDynamicHeight` (about 1240-1310) | size |
| 7 | `App.tsx` render block (about 1855-1862) | mounting the component |
| 8 | `App.tsx` background hooks, e.g. `useClipboardMonitor` (line 681) | work that runs only while the widget is on |
| 9 | `notchPanels.test.ts` ("lists the seven widgets") and `SETTINGS.md` | tests and docs |

That is shotgun surgery across a 1,943-line file. Two more widgets on top of it would make each one a repeat of this list. So **the platform comes first** (Phase 1), then the widgets.

Good news for the design:

- The saved choice (`zara-notch-panels`) already drops unknown ids on read, so new widget ids are safe and an older Zara ignores them.
- `media-update` already carries `position_ms`, `duration_ms` and `position_updated_at`, and `CompactMediaPlayer.tsx` (line 132-135) already interpolates the playhead. Lyrics sync needs no new Windows code.
- `reqwest` is already a dependency (used by the AI module) and `wiremock` is already a dev-dependency, so a Rust-side web fetch with tests is cheap.
- The clipboard widget (`clipboard_history.rs` + `useClipboardHistory.ts` + `ClipboardPanel.tsx`) is the template for "a backend feed plus a panel, with a privacy story".

## Phase 0: spikes (about 1-2 days, throwaway code)

Both new widgets rest on a fact that is not yet tested here. Find out before building.

- **S1, Claude Code hooks reach Zara from the VS Code extension and the CLI, on Windows.** The docs say hooks in `~/.claude/settings.json` are shared with the extension, but do **not** say which events the extension fires. Add a throwaway `async: true` PowerShell command hook that appends stdin to a file, then run one session in the extension and one in the terminal. Record which events arrive and how long each takes. This session is itself in the VS Code extension, so this matters.
- **S2, lyrics source.** Call LRCLIB (`https://lrclib.net/api/get` with `artist_name`, `track_name`, `duration`, and `/api/search` as fallback) for about 30 tracks you really play, using the titles Windows media controls give for each player you use (Spotify, YouTube in a browser, etc.). Record hit rate, how often synced lyrics exist, and how messy titles are. **Verify** the response shape and its User-Agent and rate-limit rules first.
- **S3, how accurate is the playhead?** The backend polls media every 2 s and emits on more than 1 s of drift. Check, per player, that `position_ms` + elapsed time stays within about 300 ms of the audio. This decides whether lyrics need a user offset slider (the plan assumes yes).

- **S4, can Zara read Windows notifications at all?** See Phase 2. Write a throwaway Rust call to `UserNotificationListener` from the current unpackaged build (`windows` crate features `UI_Notifications` and `UI_Notifications_Management`). Record: does `RequestAccessAsync` return Allowed, does `GetNotificationsAsync` return real toasts (app name, title, body, id, time), how long after a toast appears does a poll see it, and does the `NotificationChanged` event work. Also note whether a Claude Code session in the terminal or the VS Code extension produces a Windows toast on its own.

Go/no-go: if S4 shows unpackaged access fails, Phase 2 needs package identity first (see the options there). If S1 shows the extension does not fire `Stop` and `Notification`, the Claude Code widget is CLI-only and we say so in the UI. If S2 hit rate is poor, lyrics need a second source or are not worth shipping.

## Phase 1: widget registry (behavior-preserving refactor)

No visible change. Existing tests stay green; no feature work is mixed in.

**Interface first.** One module owns what a widget is:

```ts
// src/notch/widgets/NotchWidget.ts
interface NotchWidget {
  id: string;                      // also the ZaraMode while its panel is open
  label: string;                   // picker + notch
  description: string;             // one line, picker
  icon: Glyph;
  defaultEnabled: boolean;
  size: { widthPx: number; heightPx: number };
  /** The panel scrolls itself, so wheel/swipe must not cycle panels over it. */
  ownsScroll?: boolean;
  Panel: ComponentType<{ onFieldFocusChange: (focused: boolean) => void }>;
  /** Mounted only while the widget is on; for feeds (clipboard monitor, Claude Code tail). */
  Background?: ComponentType;
}
```

- `src/notch/widgets/registry.ts` is the single list. `NOTCH_PANEL_DEFINITIONS`, `NotchPanel`, the picker icons, `collapseNotch`'s mode list, the wheel exemption, width/height and the render block are all derived from it. After this, items 1-8 in the table above collapse into "add one object to the registry".
- A small `PanelShell` replaces the `AnimatePresence` + `motion.div` wrapper that Notes, Clipboard and Weather each copy.
- `Background` replaces `useClipboardMonitor(...)` being called from `App.tsx`: a component mounted per enabled widget lets each widget own its hooks without conditional hook calls.
- Migrate **one widget at a time**, one PR each (Clipboard first, since it has a background hook, then Notes, Weather). Keep each under 200 lines of change. The existing panel tests and `App.test.tsx` are the safety net.
- Add a test that fails if a registry entry is missing a field, and one that mounts every enabled widget's `Background`.

Before starting: the working tree has uncommitted work (`NotchTab.tsx`, `useSettings.ts`, `notch_monitor.rs`, the follow-cursor test). Commit or stash it so Phase 1 is a clean, reviewable branch.

## Phase 2: notch notifications (the pill)

The behavior you described: a notification appears on the laptop, and the notch grows into a pill showing it (app icon, app name, title, a line or two of body), then settles back after a few seconds.

### The pill and its channel

- A `NotchNotification` is `{ id, source, appName, appIcon?, title, body, receivedAt }`. `source` is `"windows"` or a widget id such as `"claude-code"`.
- One channel, `useNotchNotifications`, takes them from any source. It shows one pill at a time, queues the rest (short queue; a burst should not hold the notch), never interrupts an open notch or the shelf, and honors Peek mode. That is exactly the rule `useDeviceAlerts.ts` already implements for devices (queue of 3, per-alert duration, `triggerEventPeek`), generalized. Do not migrate device alerts in this phase; build the channel for notifications, and move devices onto it later only if it still looks worth it.
- The pill is a new view next to `DeviceAlertBubble.tsx`: hover pauses the dismiss timer, click dismisses (opening the source app is a later option), sized through the Phase 1 registry-style size rule.
- Persistent activities (music, timer) keep their current rule. The lyrics ticker rides on the music activity (Phase 3).

### Source A: Windows notifications

Windows exposes other apps' toasts through `UserNotificationListener` (`Windows.UI.Notifications.Management`). What the research found, and what is still unknown:

- The user must allow it (Windows Settings, Privacy, Notifications), and the app calls `RequestAccessAsync` from its UI thread. Microsoft's guide ([notification listener](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener)) says to add the `userNotificationListener` capability to the app manifest, which assumes a **packaged** app. Zara is an unpackaged Tauri build.
- Microsoft says many Windows features only work for desktop apps that have package identity, and that most `Request...` methods are not supported in desktop apps ([package identity for unpackaged apps](https://learn.microsoft.com/cs-cz/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)). Nothing I found says outright whether `UserNotificationListener` is one of them.
- One community Rust crate ([crcbl-notify](https://docs.rs/crcbl-notify/latest/crcbl_notify/)) reports that an unpackaged process was allowed on Windows 11, but that the `NotificationChanged` event fails (error 0x80070490), so it polls `GetNotificationsAsync` snapshots. That is a single unofficial report, so S4 has to confirm it on your machine.

So there are three ways in, and S4 picks one:

| Option | What it means | Verdict |
|---|---|---|
| Unpackaged, poll snapshots | Worker thread calls `GetNotificationsAsync` every 500-1000 ms and diffs by notification id. No installer change. | Try first. Poll latency is the cost (up to a second). |
| Sparse package ("package with external location") | Keeps the NSIS installer and the auto-updater, adds package identity so the capability and the event work. | The fallback if the unpackaged path is refused. More installer work; touches the release process and `RELEASE_CHECKLIST.md`. |
| Full MSIX | Real packaging. | Last resort; would change updates and install paths. |

Rules that hold whichever option wins:

- **Zara cannot hide Windows' own toast.** The listener only reads. The user will see both the system toast and the notch pill unless they silence toasts themselves (Windows Do Not Disturb or per-app settings). The Settings page should say so, in one line.
- **Start from a baseline.** At start-up, record the ids already in the Action Center and show only newer ones, so launching Zara does not replay old notifications.
- **Ignore Zara's own notifications** (e.g. the update prompt) to avoid a loop.
- **Pure, tested core in Rust** (`src-tauri/src/notifications.rs`): `new_since(previous_ids, snapshot)`, de-duplication, ignore list, and body trimming, all unit tested without Windows. The WinRT calls stay in a thin wrapper that cannot be unit tested and is covered by the S4 spike and a manual checklist.
- Emits one event, `windows-notification`, to the channel.

### Privacy: this is the most sensitive data in the plan

Notifications carry private messages, email and one-time login codes.

- **Off by default.** Turning it on explains what is read and where it goes (only to the notch window, never saved to disk, never sent to the assistant).
- **Per-app list:** choose which apps may appear. No app is on until chosen.
- **Hide content option:** show only "App name: new message" without the body.
- **Respects Stealth mode** (`stealth.rs`): while stealth is active the pill must not draw, since the point of stealth is that nothing shows during a screen share. This needs a test.
- In memory only, short queue, cleared when the feature is turned off; add it to `docs/privacy.md`.
- Settings keys (documented in `SETTINGS.md`): `zara-notifications-enabled` (default `"false"`), `zara-notifications-apps` (JSON list), `zara-notifications-show-body`, `zara-notifications-duration-ms`.

### Source B: widgets

A widget posts into the same channel with its own `source`. Claude Code (Phase 4) and, if wanted, other widgets use this instead of drawing their own alert.

## Phase 3: Lyrics widget

**Backend** (`src-tauri/src/lyrics.rs`, a deep module with one command):

- `lyrics_for_track(title, artist, duration_ms) -> LyricsResult` where the result is synced lines `{ time_ms, text }`, or plain text, or instrumental, or not found.
- Fetch in Rust, not the webview: no CSP change, a proper User-Agent, and a disk cache in app data keyed by normalized artist + title + duration. Cache misses too, with a short expiry, so a track with no lyrics is not re-requested every play.
- Pure, tested functions: `parse_lrc` (several timestamps per line, `[offset:]` tag, blank lines), and `normalize_track` (strips "(feat. X)", "- Remastered 2011", "(Official Video)", and splits "Artist - Title" when a browser puts both in the title).
- Tests: `parse_lrc` and `normalize_track` as plain unit tests; the HTTP path against `wiremock` (hit, miss, 429, timeout). No real network in tests.
- Register in `generate_handler!` in `main.rs` and make the command `async` on a blocking-pool thread, as `scripts/synchronousCommands.test.ts` requires.

**Frontend** (`src/notch/lyrics/`):

- Extract the playhead interpolation from `CompactMediaPlayer.tsx` into `usePlaybackClock` (shared, tested), so lyrics and the progress bar agree.
- `useCurrentLyricLine(lyrics, clock, offsetMs)`: binary search for the active line, then schedule one timeout for the next line instead of polling. Detects seeks from a jump in `position_ms`.
- `LyricsPanel`: full lyrics, current line highlighted and scrolled into view; plain-text fallback; "no lyrics for this track".
- Pill ticker: current line shown with the existing `TitleMarquee` when music is the live activity and the lyrics widget is on.
- Settings (`zara-` keys, documented in `SETTINGS.md`): `zara-lyrics-offset-ms`, `zara-lyrics-pill-ticker`.
- Tests: Vitest for line selection, seek handling and offset; component test for the panel's three states (synced, plain, none) with the command mocked at the `invoke` seam.

**Privacy and licence, decide before shipping:**

- Each new track sends its artist, title and duration to a third party (lrclib.net). The widget must be off by default, say so where it is turned on, and be added to `docs/privacy.md`.
- Song lyrics are copyrighted. LRCLIB is community-sourced and the app is public (GPL). Showing the current line is lighter than showing a full lyric sheet, and the cache is local, but this is a real question for a public release.

## Phase 4: Claude Code widget

### How Zara learns what Claude Code is doing

Chosen path: **a Claude Code hook writes each event to a small spool file, and Zara reads it.**

| Option | Verdict |
|---|---|
| `command` hook, `async: true`, appends the event JSON to a file in Zara's app data | **Chosen.** Never slows Claude Code (async). No open port, so no way for a web page or other local process to forge events. Works if Zara is not running (events wait in the file). |
| `http` hook POSTing to a localhost server inside Zara | Docs say hooks of this type block Claude Code by default and have no `async` option; localhost is only shown in an example. A listening port can also be forged by any local process. Rejected for now. |
| Parse `~/.claude/projects/**/*.jsonl` transcripts | The docs state the format is internal and changes between versions. Not a source of truth. |
| `statusLine` | Gives cost and context numbers, but there is only one status line per user and Zara must not take over one the user already has. Optional later enrichment, not the feed. |
| OpenTelemetry export | Needs environment variables and a receiver; heavier than the need. |

Events to subscribe to (all documented): `SessionStart`, `UserPromptSubmit`, `Notification` (`permission_prompt`, `idle_prompt`), `Stop` (has `last_assistant_message`), `SubagentStop`, `SessionEnd`. Not `PreToolUse`/`PostToolUse` by default: they fire constantly and each fires a PowerShell start-up. Tool activity can be an opt-in setting later.

### Backend (`src-tauri/src/claude_code.rs`)

- `parse_hook_event(json) -> Option<ClaudeEvent>`: pure, tolerant of missing and unknown fields.
- `SessionBoard`: pure reducer from events to per-session state `working | needs_input | done | ended`, plus project name (from `cwd`), title (`session_title`), a short excerpt of the last message, and `updated_at`. A session with no event for N minutes is marked stale, because a crashed session never sends `SessionEnd`.
- A tail loop on the spool file (poll file length every 500 ms, remember the offset, handle truncation and rotation; cap the file size). Emits `claude-code-changed`, the same pattern as `clipboard-history-changed`.
- Commands: `claude_code_sessions`, `claude_code_status`, `claude_code_connect`, `claude_code_disconnect`.
- **Privacy, copying the clipboard module's rules:** state in memory only, excerpts truncated, the tail only runs while the widget is on, turning it off wipes state and truncates the spool.
- Tests: `parse_hook_event` against fixture JSON for every subscribed event (including future unknown fields); `SessionBoard` transitions, stale handling, many sessions; the tail loop against a `tempfile` spool.

### Connecting Claude Code (needs your explicit say-so in the UI)

`claude_code_connect` edits `~/.claude/settings.json`, a file Zara does not own. So:

- Show exactly what will be added before writing; require a click.
- Back the file up, merge into the existing `hooks` key (hooks merge across files, so this does not replace what you have), and tag Zara's entries with a marker so they are found again.
- Idempotent (connecting twice adds nothing); `claude_code_disconnect` removes only tagged entries.
- Never fail silently on a settings file Zara cannot parse; leave it untouched and report why.
- Tests against temp copies of settings files: empty, with other hooks, already connected, malformed, disconnect restores.

### Frontend (`src/notch/claudeCode/`)

- `useClaudeCode` (like `useClipboardHistory`).
- `ClaudeCodePanel`: one card per session, coloured by state (working, needs you, done); project name, last message excerpt, age.
- **Notch notifications are the main output.** "Needs your input" and "finished" are posted to the Phase 2 channel with `source: "claude-code"` and show as the same pill as a Windows notification, each kind switchable. Not shown while the notch is open.
- **Possible shortcut, decided by S1 and S4:** if Claude Code already raises Windows toasts on your setup, Phase 2's per-app list would mirror them with no hook at all. The hook route is still better for the VS Code extension and for "needs your input" detail, but check before building it.
- Settings keys: `zara-claude-code-alert-input`, `zara-claude-code-alert-done`, plus the connect/disconnect control (a Settings section, in the style of `UpdatesSection`).
- Tests: panel states with the hook mocked; alert rules (not while open, queue, per-kind switch); the Settings connect flow with the commands mocked.

## Phase M: music card layout

Updated 2026-11-08 from the reference image and your decisions. The music view becomes a rounded card whose background **is** the album art. No like button, no share button, no pill behind the text. The card has the music controls and the volume control, and keeps the glow, now tied to the cover's colors.

```
 ┌────────────────────────────────┐
 │ Artist                         │  ← plain text on a blurred, darkened top band
 │ Track title…                   │
 │                                │
 │        (full-bleed             │
 │         album art)             │
 │ 0:52 ━━━━━━━━━━──────── -1:21  │  ← elapsed, thin progress bar, remaining
 │   (⏮)       (▶)       (⏭)      │  ← round glass buttons, play is larger
 │ 🔈 ━━━━━━━━━━━━━━━━━━━━━━ 🔊   │  ← volume slider
 └────────────────────────────────┘
        soft glow outside the card, in the cover's colors
```

**What exists today.** Two layouts, `"classic"` and `"compact"` (`zara-media-layout`), chosen by tapping the art; `CompactMediaPlayer.tsx` (383 lines) and the classic branch of `MusicPlayerView.tsx` (314 lines); a Settings preview in `PreviewMediaPlayer.tsx`. The layout name is repeated in `MusicPlayerView`, `useNotchSettings`, `useSettings`, `PreviewMediaPlayer` and the width/height branches in `App.tsx` (about lines 1258 and 1303), the same scatter as the widget list in Phase 1. `MusicPlayerView` has no test of its own.

### The glow

Today's glow (`.notch-ambient-glow`, `App.css` line 1635) is the album art itself, scaled 1.8x, blurred 52 px and over-saturated. That follows the colors *where they sit in the picture*: a cover with a face in the middle and red around it mostly shows whatever is at the center after the crop, so it does not reliably match "mostly red and purple".

Plan: **pick the colors on purpose, then draw them.**

- `extractGlowPalette(pixels)` is a pure function. It takes the art shrunk to about 32 × 32 and returns up to three colors with weights.
  - Ignore transparent, near-black and near-white pixels, because they make a dull glow.
  - Group the rest by hue, weighting each pixel by its saturation, so a vivid red counts more than a grey.
  - Keep the strongest groups that are at least about 30° apart in hue, so "red and purple" gives red and purple and not two reds.
  - Average each group, then lift saturation and lightness into a range that glows (not muddy, not neon).
  - If the art is nearly colorless, return a soft neutral white.
- A small loader shrinks the art once per track (keyed by the existing `albumArtKey`) and caches the result. It is cheap, but if the frame probe (`zara-frame-probe`) shows any hitch, move it to Rust, where the `image` crate is already a dependency and the art is already produced once per track.
- The glow becomes layered radial gradients in those colors, sized by weight, behind the card, with a cross-fade between tracks (the same 0.6 s the glow uses now). The existing `zara-media-ambience-enabled` setting still turns it off. The collapsed pill's glow (`zara-media-compact-glow-enabled`) can take the same palette.
- Tests: `extractGlowPalette` with synthetic pixel arrays (mostly red with some purple returns red then purple; a grey image returns the neutral; black borders are ignored; one dominant color returns one color). The canvas step stays out of the unit test.

### The blurred top

The artist and title sit directly on the art, so the top band needs to be readable on any cover, bright ones included.

- A band over the top third with a backdrop blur plus a dark-to-clear gradient.
- **Risk to check first:** a comment in `App.css` (line 1659) says `mask-image` is buggy in WebView2, so a fading blur edge done with a mask may not work. Plan: build the band from two or three stacked strips with increasing blur and opacity, or a plain gradient with a lighter blur, and confirm on a bright cover (white, yellow) before settling.
- The blur is the one expensive part (the notch performance plan is about keeping animation smooth). Measure it with the frame probe while the card opens.

### Volume

The card shows a thin volume slider under the transport buttons, always visible, with a speaker icon at each end. That is simpler than the compact layout's tap-to-expand and costs about 30 px of height. The existing `LevelSlider` component (`src/notch/components/`) may already fit; check before writing a new one. The audio-output (headphones) button from the compact layout stays in the card, in the row with the transport buttons, and still opens the system sound settings (`open_sound_settings`).

### Plan

1. **Share the playhead first.** Pull the position logic out of `CompactMediaPlayer` (extrapolation, seek handling, and the `formatTime` / `formatRemaining` helpers, which are also copied elsewhere) into `usePlaybackClock` and a tested `formatPlaybackTime`. The lyrics widget (Phase 3) needs the same hook, so it is built once. Behavior-preserving, with fake-timer tests for extrapolation, seeking and a paused track.
2. **Add `"card"` as a third layout** (decided): classic and compact stay exactly as they are. Give layouts one small table (`id`, width, height rule) used by `App.tsx`, the settings, the preview and the persisted-value check.
3. **Glow palette:** `extractGlowPalette`, the loader, and the gradient glow, switched on for the card layout first; moving classic and compact onto it is a follow-up if you like the result.
4. **`MusicCardView`** (new, in `src/notch/views/`): full-bleed art that cross-fades on track change; the blurred top band with artist and title (keep the title marquee); progress and times (seek only when the player allows it and a duration exists); the round glass buttons using `glassSettings.ts`, with the existing previous/next slide animations; the volume slider; the stealth rule. Size about 300 × 316, clamped for small screens like `fitAiPanelHeight`.
5. **Settings:** add "Card" to the layout choice and to `PreviewMediaPlayer`; update `SETTINGS.md`.
6. **Tests:** `MusicCardView` with the media hook mocked (title and artist shown; elapsed and remaining from the clock; play, previous and next call the controls; volume change calls the volume handler; no progress bar without a duration; seek disabled when the player does not allow it; placeholder when there is no art); the layout size table; the layouts setting accepts `"card"` and ignores unknown values. Text contrast on bright art is a manual check on a few covers.

Left out on purpose (decided): like, share/open, and a Spotify sign-in. If you want a lyrics button in the card later, it fits the top-right corner (Phase 3).

## Order, size and ownership

| Step | Output | Size |
|---|---|---|
| 0 | Spike notes: S1, S2, S3 and a go/no-go | 1-2 days |
| 1 | Registry + `PanelShell` + `Background`; Clipboard, Notes, Weather migrated | 4-5 small PRs |
| 2 | Notch notifications: channel + pill, then the Windows listener (core, wrapper, per-app settings, stealth rule) | 4 PRs, plus installer work if S4 says identity is needed |
| M | Music card: `usePlaybackClock` extraction, layout table, cover-color glow, `MusicCardView`, settings + preview | 5 PRs (the clock extraction is shared with lyrics) |
| 3 | Lyrics: Rust module, then panel, then pill ticker | 3 PRs |
| 4 | Claude Code: parser + board, tail, connect/disconnect, panel, notifications | 5 PRs |

Notifications go first among the features because they are what you asked for most directly, and Claude Code depends on the channel. Lyrics needs nothing outside the app and could run in parallel. Claude Code touches a file in your home folder, so it gets the most care and comes last.

Each PR follows the repo rules: conventional commit, under about 200 changed lines, `SETTINGS.md` updated for new keys, tests in the same PR (Vitest for the frontend, `cargo test` for Rust), and `bun run build`, `cargo clippy --locked --all-targets` and `cargo test --locked` green.

## Risks

- **Reading Windows notifications may need package identity.** If the unpackaged path is refused, the sparse-package fallback touches the installer and updater. S4 settles this first.
- **Notification content is sensitive** (messages, login codes). Off by default, per-app, hidden in stealth, never stored.
- **Double display:** the Windows toast still shows next to the pill; Zara cannot suppress it.
- **VS Code extension hook parity is undocumented.** S1 settles this first.
- **Lyrics timing drift** from the 2 s media poll and per-player quirks. Mitigated by interpolation plus a user offset; S3 measures it.
- **Title mess from browsers** lowers the lyrics hit rate. Mitigated by `normalize_track`; S2 measures it.
- **Editing `~/.claude/settings.json`.** Mitigated by consent, backup, markers and tests, but it is the riskiest single step.
- **`App.tsx` is already 1,943 lines.** Phase 1 should shrink it; no phase adds widget code to it.
- **Pill space.** The collapsed pill is about 140 px wide; the lyrics ticker and alerts must fit or grow it the way music already does.

## Decisions that are yours

1. **Which Windows apps should appear in the pill?** The plan makes you choose per app (none by default) and offers a hide-content mode. If you want everything on by default, that is a privacy decision to make deliberately.
2. **Duplicate toast.** Are you fine with the Windows toast and the pill both showing, or do you want Settings to guide users to silence Windows toasts?
3. **"Lyrics as a trigger".** The plan covers: a lyrics panel, a pill ticker, and saving a line to Notes. If you meant a lyric should *trigger* something, two options fit: an **Ask Zara** button that sends the line to the assistant ("what does this mean?"), or timed actions on a line. Pick which, or none.
4. **Only built-in widgets, or user-installable ones?** This plan is built-in only. A registry does not rule out plugins later, but plugins add a security and API-stability burden you may not want yet.
5. **Music card:** decided: a third layout, with the headphones button kept, and no like or share. Nothing open.
6. **Lyrics source and licence comfort** (see Phase 3).
