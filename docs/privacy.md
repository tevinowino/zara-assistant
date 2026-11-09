# Privacy and network egress

Zara has no telemetry and no analytics. The one check it makes on its own is for a
new version of itself (see the `github.com` row below), which you can turn off in
Settings > About. Everything below is the complete list of places the app can send data. A test (`scripts/brand.test.ts`) keeps the
webview's allowed hosts in line with this list.

## From the webview (limited by the Content-Security-Policy in `src-tauri/tauri.conf.json`)

| Host | Used for | What is sent | Notes |
|---|---|---|---|
| `api.open-meteo.com` | Weather widget | Latitude and longitude | Free service, no key |
| `geocoding-api.open-meteo.com` | Looking up a city name | The city text you type | |
| `ipapi.co`, `ip-api.com` | Finding your approximate location for weather | Your IP address (implicitly) | Phase 9 makes this opt-in |

## From the Rust backend (not subject to the webview policy)

| Host | Used for | What is sent |
|---|---|---|
| `lrclib.net` | The Lyrics widget, once for each song that plays while the widget is on (Settings > Notch > Widgets), and the lyrics button on the music card, once for each song that plays while the card is open with the button on. Off by default | The song's artist, title and length, as the player reports them, in the address of the request. LRCLIB sees your IP address and the request, like any website. The answer is kept in `lyrics-cache` so the same song is not asked about again; "no lyrics" is asked about again after a day |
| `github.com` (the project's releases) | Checking for a new version of Zara and downloading it, shortly after startup and when you press "Check now" in Settings > About. Off with "Check automatically" (`zara-auto-update-check`). Asks you before installing | A request for a public file (`latest.json`), then for the installer if you accept. GitHub sees your IP address and the request, like any download. Nothing about you or your settings is sent. The installer is verified against a public key built into Zara before it runs |
| The AI service you choose in Settings > Assistant: `openrouter.ai` (the default), `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `integrate.api.nvidia.com`, `api.groq.com`, `api.mistral.ai`, `api.x.ai`, `api.deepseek.com`, an Ollama server on this PC, or an address you type | The assistant, and listing the models a service offers | Your messages, recent conversation history, your saved memories and notes when relevant, and a screenshot when you ask Zara to look at your screen. A service that resells models (OpenRouter) forwards the request to the provider hosting the model, so that provider sees it too. Each service has its own terms for how it handles and may use what you send; check the one you pick. The API key is sent in a request header to that service only, never in the URL |
| The search provider OpenRouter uses (Exa unless OpenRouter chooses otherwise) | Web search, only when the assistant decides a question needs it and Settings > Assistant > "Let Zara search the web" is on | Your question, as the search query. OpenRouter runs the search and adds the results to the request. Each search costs about a cent on your OpenRouter account |
| Google Search (through the Gemini API, when Google is your AI service) | The same web search, using Google's own search instead of OpenRouter's | Your question, as the search query, inside the request to `generativelanguage.googleapis.com`. Google runs the search and the answer ends with links to the pages it used. Search is billed by Google under your key's plan |

## Windows notifications (off by default)

If you turn on "Notification Pill" in Settings > Notch, Zara asks Windows for permission to read the notifications in the Action Center, then shows the ones from apps you allow as a pill in the notch.

- Nothing is read until you turn it on. Turning it off stops the reading at once.
- What a notification says is held in memory only, long enough to show it. It is not written to disk, logged, sent to the assistant, or sent anywhere else.
- Notifications that were already in the Action Center when you turned it on are not shown.
- No app shows a pill until you allow it. Apps you have not allowed are remembered by name only (so Settings can list them), never by what they said.
- "Show Message Text" off shows only the app's name. The text is also hidden whenever Stealth is switched on but is not holding, because the notch could then be on a shared screen.
- Zara's own notifications are skipped.
- Windows still shows its own notification as well; Zara cannot hide it.
## Claude Code (off by default)

If you turn on the Claude Code widget and press "Connect" in Settings > Notch > Claude Code, Zara adds hooks to Claude Code's own settings file (`%USERPROFILE%\.claude\settings.json`, or inside `CLAUDE_CONFIG_DIR` if you set that). Settings shows exactly what will be added first, a copy of the file as it was is kept beside it as `settings.json.zara-backup`, and Disconnect removes only Zara's entries.

- The hooks run a small PowerShell script (`claude-code-hook.ps1`, in `%APPDATA%\com.zara.app\`) in the background. For each event it appends one line to `claude-code-events.jsonl` in the same folder: the event, the session id, the project folder, the session's title and, when Claude needs you or finishes, the first few hundred characters of Claude's message.
- It never keeps what you type, what Claude's tools were given or what they returned.
- The file exists only while the Claude Code widget is on: turning the widget off deletes it, and without it the script does nothing. If Zara is not running, the script stops adding to it at 512 KB.
- The state of each session is held in memory only, and is forgotten when the widget is turned off.
- Nothing leaves your PC. There is no local server: nothing can write to Zara over the network.
- Alerts hide the project and what Claude said when "Show Message Text" is off, or while Stealth is switched on but not holding.
## Claude Code usage (off by default)

If you press "Allow" in the Claude Code widget's Usage view (or turn on "Usage Dashboard" in Settings > Notch > Claude Code), Zara reads the transcript files Claude Code keeps in `%USERPROFILE%\.claude\projects\` (or inside `CLAUDE_CONFIG_DIR`) to count your usage.

- Those files hold your conversations. Zara reads past the text and keeps only counts: the tokens of each response, its model, the project folder's name, a session id, the time, and the ids of tool calls. It never keeps, shows or sends what was said.
- It is held in memory only and forgotten when you turn it off or quit. Nothing is written to disk and nothing leaves your PC.
- Only files changed in the last two months are read, and only while the widget is on.
- The cost shown is an estimate: tokens at public API prices, from a table inside Zara. It is not what a subscription charges, and a model not in the table is counted without a cost.
- The transcript format is Claude Code's own and may change in an update; if it does, the view shows fewer numbers until Zara is updated.

## Stored on this PC

- Settings: `%APPDATA%\com.zara.app\settings.json`
- Lyrics already looked up: JSON files in `%APPDATA%\com.zara.app\lyrics-cache\` (the newest 300 songs; delete the folder to clear it)
- Notes, conversations, memories and shortcut choices: JSON files in `%APPDATA%\com.zara.app\ai\`
- API keys, one per service: Windows Credential Manager, never a file. The chosen service, model, fallback model and any server address are in `settings.json` (they are not secrets)
- Diagnostics log: `%LOCALAPPDATA%\com.zara.app\diagnostics.log` (rotated at 1 MB, must never contain secrets)

## What leaves your PC, and when

- Typed messages and the last few turns of the conversation: with every question.
- Your saved memories: with every question (they are part of the instructions).
- Your notes: only when you ask about them.
- A screenshot of the monitor under the pointer: only when your question needs it.
- Your question as a web search query: only when the assistant decides it needs current information and web search is on (the default; one switch in Settings turns it off).
- Nothing is sent when the assistant is not used.

Text and images that come back are treated as untrusted: links open only as web or mail links in your browser, remote images are never loaded, and anything the assistant saves or changes on its own is capped and shown to you.
