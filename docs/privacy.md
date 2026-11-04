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
| `fonts.googleapis.com`, `fonts.gstatic.com` | Web fonts | Standard font requests | Candidate to self-host |

## From the Rust backend (not subject to the webview policy)

| Host | Used for | What is sent |
|---|---|---|
| `github.com` (the project's releases) | Checking for a new version of Zara and downloading it, shortly after startup and when you press "Check now" in Settings > About. Off with "Check automatically" (`zara-auto-update-check`). Asks you before installing | A request for a public file (`latest.json`), then for the installer if you accept. GitHub sees your IP address and the request, like any download. Nothing about you or your settings is sent. The installer is verified against a public key built into Zara before it runs |
| The AI service you choose in Settings > Assistant: `openrouter.ai` (the default), `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `integrate.api.nvidia.com`, `api.groq.com`, `api.mistral.ai`, `api.x.ai`, `api.deepseek.com`, an Ollama server on this PC, or an address you type | The assistant, and listing the models a service offers | Your messages, recent conversation history, your saved memories and notes when relevant, and a screenshot when you ask Zara to look at your screen. A service that resells models (OpenRouter) forwards the request to the provider hosting the model, so that provider sees it too. Each service has its own terms for how it handles and may use what you send; check the one you pick. The API key is sent in a request header to that service only, never in the URL |
| The search provider OpenRouter uses (Exa unless OpenRouter chooses otherwise) | Web search, only when the assistant decides a question needs it and Settings > Assistant > "Let Zara search the web" is on | Your question, as the search query. OpenRouter runs the search and adds the results to the request. Each search costs about a cent on your OpenRouter account |
| Google Search (through the Gemini API, when Google is your AI service) | The same web search, using Google's own search instead of OpenRouter's | Your question, as the search query, inside the request to `generativelanguage.googleapis.com`. Google runs the search and the answer ends with links to the pages it used. Search is billed by Google under your key's plan |

## Stored on this PC

- Settings: `%APPDATA%\com.zara.app\settings.json`
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
