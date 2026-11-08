# Zara Settings Reference

All settings are stored in `settings.json` in the app config directory (`%APPDATA%/com.zara.app/`). The file is a flat JSON object with `zara-` prefixed keys. Zara watches this file for external changes and applies them in real-time.

## Quick Start

Edit `settings.json` with any text editor while Zara is running. Changes are applied immediately — no restart required.

```json
{
	"zara-theme-mode": "dark",
	"zara-scale": "1.0"
}
```

## Settings Keys

### Notch

| Key                      | Type                             | Default   | Description                                                                                                                    |
| ------------------------ | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `zara-notch-mode`       | `"fixed"` / `"smart"` / `"peek"` | `"fixed"` | Notch (top bar) visibility behavior. **peek** shows the notch briefly on media events and notifications.   |
| `zara-notch-follow-cursor` | `"true"` / `"false"` | `"true"` | With more than one screen, whether a Smart or Peek notch moves to the screen the cursor rests at the top of. Fixed always stays on the primary screen. Set in Settings > Notch. |
| `zara-notch-edge-delay` | milliseconds `"0"`–`"2000"`      | `"200"`   | In smart/peek mode, how long the cursor must rest against the top screen edge before the notch peeks. `"0"` reveals instantly. |

### Weather

| Key                              | Type                         | Default     | Description                                                                        |
| -------------------------------- | ---------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `zara-weather-enabled`          | `"true"` / `"false"`         | `"true"`    | Show weather widget in the notch status bar.                                       |
| `zara-weather-city`             | string                       | `""`        | Manually set city name for weather. Empty string = auto-detect via IP geolocation. |
| `zara-weather-lat`              | number string                | (auto)      | Latitude coordinate for weather. Set automatically when a city is selected.        |
| `zara-weather-lon`              | number string                | (auto)      | Longitude coordinate for weather. Set automatically when a city is selected.       |
| `zara-weather-cached-temp`      | number string                | (none)      | Cached temperature value shown before next API fetch.                              |
| `zara-weather-cached-condition` | string                       | (none)      | Cached weather condition text (e.g. "Partly Cloudy").                              |
| `zara-temp-unit`                | `"celsius"` / `"fahrenheit"` | `"celsius"` | Temperature display unit.                                                          |

### Modules

| Key                         | Type                              | Default  | Description                                                                                              |
| --------------------------- | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `zara-calendar-enabled`    | `"true"` / `"false"`              | `"true"` | Enable calendar/timer mode in the notch.                                                                 |
| `zara-notch-command-center-enabled` | `"true"` / `"false"` | `"true"` | Show the Command Center panel in the notch. |
| `zara-notch-devices-enabled` | `"true"` / `"false"` | `"false"` | Show the Connected devices panel in the notch. Settings keeps at least one of the panels (assistant, calendar, Command Center, Connected devices) on; if all are off, the notch shows Command Center. |
| `zara-notch-ai-enabled` | `"true"` / `"false"` | `"true"` | Show the Zara assistant panel in the notch (the default panel for new installs). Settings keeps at least one panel on. |
| `zara-stealth-enabled` | `"true"` / `"false"` | `"false"` | Hide Zara's windows from screen capture and sharing (Windows 10 2004+). Written by Settings > Assistant. |
| `zara-music-mode-enabled`  | `"true"` / `"false"`              | `"true"` | Enable interactive music media widget.                                                                   |
| `zara-music-compact-notch` | `"true"` / `"false"`              | `"true"` | Show compact music display (visualizer + artwork) in collapsed notch.                                    |
| `zara-notch-remember-panel` | `"true"` / `"false"` | `"true"` | Click opens the last-used panel when on; when off, click opens `zara-notch-default-panel`. When on, the assistant also picks up the conversation it was last showing at launch (`zara-ai-last-conversation`). |
| `zara-notch-default-panel` | `"calendar"` / `"command-center"` / `"devices"` | `"calendar"` | Fixed panel opened on click when panel memory is off. If that panel is turned off, the first panel that's on opens instead. |
| `zara-ai-provider` | `openrouter` / `openai` / `anthropic` / `google` / `nvidia` / `groq` / `mistral` / `xai` / `deepseek` / `ollama` / `custom` | `openrouter` | The AI service the assistant uses. Set in Settings > Assistant. |
| `zara-ai-model-<service>` | model id | the service's default | The model for that service, such as `zara-ai-model-anthropic`. Empty means the default. |
| `zara-ai-fallback-model-<service>` | model id | (none) | A second model, tried when the main one is busy or fails. On the same service unless `zara-ai-fallback-provider-<service>` names another. |
| `zara-ai-fallback-provider-<service>` | service name | (same service) | The service the backup model runs on. It uses that service's own key; without one, the backup is left out and the main model still answers. |
| `zara-ai-tuning-<service>` | JSON text | `{}` | Each model's request settings, from model name to its values: reasoning effort or thinking budget, temperature, top P, top K, longest answer, seed, and extra request fields. Only what is set here is sent; "Default" in Settings means not sent. Set in Settings > Assistant > Model settings. |
| `zara-ai-base-url-<service>` | address | (none) | The address of an `ollama` or `custom` server. `https://`, or `http://` only to this computer. |
| `zara-auto-update-check` | `"true"` / `"false"` | `"true"` | Whether Zara checks for a new version shortly after startup and asks before installing it. Set in Settings > About. |
| `zara-update-skipped-version` | version | (none) | The newest version you chose "Later" for, so it is not offered again at every start. A newer version is offered. |
| `zara-ai-web-search` | `"true"` / `"false"` | `"true"` | Lets the assistant search the web when it needs current information. With OpenRouter each search is sent to a search provider and costs a small extra charge; with Google it uses Google Search. Not available with the other services. Set in Settings > Assistant. |
| `zara-notch-last-panel`    | `"ai"` / `"calendar"` / `"command-center"` / `"devices"` | (unset)  | Last panel the notch was left on, saved by Zara while panel memory is on. |
| `zara-ai-last-conversation` | conversation id | (unset) | The conversation the assistant was last showing. Resumed at launch while `zara-notch-remember-panel` is on. Written by Zara. |
| `zara-notch-click-to-open` | `"true"` / `"false"` | (legacy) | Old setting read only when `zara-notch-remember-panel` is absent; `"false"` now selects fixed-panel behavior. |
| `zara-device-looks` | JSON object, device name → `"headphones"` / `"round-buds"` / `"stem-buds"` / `"neckband"` / `"speaker"` for Bluetooth audio; `"headphones-wired"` / `"earbuds-usbc"` / `"earbuds-jack"` / `"speaker"` / `"microphone"` for wired and USB audio | (unset) | The drawing an audio device's connection popup uses, picked under "Looks like" in the notch's Connected devices panel (or, for Bluetooth, its Bluetooth view). Devices without a pick are guessed from their name and class. |

### Shelf

| Key                   | Type                 | Default   | Description                                                                                                    |
| --------------------- | -------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `zara-shelf-persist` | `"true"` / `"false"` | `"false"` | Keep notch shelf items across restarts. Off = items are cleared when Zara closes. Max 10 items, newest first. |

### Music Appearance

| Key                                | Type                      | Default     | Description                                                                                     |
| ---------------------------------- | ------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `zara-media-layout`               | `"classic"` / `"compact"` | `"classic"` | Expanded player style. **classic** = large album art. **compact** = small thumbnail + controls. |
| `zara-media-ambience-enabled`     | `"true"` / `"false"`      | `"true"`    | Colored ambient glow behind expanded album art.                                                 |
| `zara-media-compact-glow-enabled` | `"true"` / `"false"`      | `"true"`    | Glow effect around the collapsed compact thumbnail.                                             |
| `zara-media-visualizer-enabled`   | `"true"` / `"false"`      | `"true"`    | Audio visualizer bars in music mode. Also accepts `zara-visualizer-enabled` (legacy alias).    |
| `zara-media-album-art-enabled`    | `"true"` / `"false"`      | `"true"`    | Show album artwork in the notch music display.                                                  |

### Overlays

| Key                                | Type                 | Default  | Description                                                              |
| ---------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------ |
| `zara-volume-overlay-enabled`     | `"true"` / `"false"` | `"true"` | Show Zara volume HUD when volume changes (replaces native Windows OSD). |
| `zara-volume-edge-enabled`        | `"true"` / `"false"` | `"true"` | Trigger volume HUD by hovering the left screen edge.                     |
| `zara-brightness-overlay-enabled` | `"true"` / `"false"` | `"true"` | Show Zara brightness HUD when brightness changes.                       |
| `zara-brightness-edge-enabled`    | `"true"` / `"false"` | `"true"` | Trigger brightness HUD by hovering the right screen edge.                |

### Appearance

| Key                      | Type                                             | Default     | Description                                                                                                                                                 |
| ------------------------ | ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zara-theme-mode`       | `"dark"` / `"light"` / `"custom"` / `"adaptive"` | `"dark"`    | Theme mode. **dark** = dark translucent. **light** = light translucent. **custom** = user-picked color. **adaptive** = follows Windows system accent color. |
| `zara-theme-color`      | hex string                                       | `"#007aff"` | Custom theme color (used in `custom` and `adaptive` modes).                                                                                                 |
| `zara-theme-opacity`    | float string                                     | `"0.80"`    | Background opacity (0.1 to 1.0).                                                                                                                            |
| `zara-theme-saturation` | float string                                     | `"0.50"`    | Color saturation for custom/adaptive themes (0.0 to 1.0).                                                                                                   |
| `zara-theme-brightness` | float string                                     | `"0.15"`    | Background brightness for custom/adaptive themes (0.0 to 1.0).                                                                                              |
| `zara-corners-enabled`  | `"true"` / `"false"`                             | `"false"`   | Render rounded screen corner overlays on top edges.                                                                                                         |

### Status Widgets

| Key                    | Type        | Default                                    | Description                                                                                                 |
| ---------------------- | ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `zara-status-widgets` | JSON string | `{"left":["weather"],"right":["battery"]}` | Widget layout in collapsed notch. Available: `"weather"`, `"battery"`, `"cpu"`, `"ram"`, `"disk"`, `"net"`. |

Example:

```json
{
	"zara-status-widgets": "{\"left\":[\"cpu\",\"ram\"],\"right\":[\"battery\",\"net\"]}"
}
```

### System

| Key                            | Type                 | Default   | Description                                                                                          |
| ------------------------------ | -------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `zara-scale`                  | float string         | `"1.0"`   | UI scale factor (0.8 to 1.3). Changing this re-registers AppBars to resize the reserved screen area. |
| `zara-low-battery-threshold`  | integer string       | `"20"`    | Battery percentage that triggers the low-battery alert pulse (5 to 50, step 5).                      |
| `zara-time-format-24h`        | `"true"` / `"false"` | `"false"` | Use 24-hour clock format in the notch. When `"false"`, displays 12-hour format with AM/PM.           |

### Internal (Do Not Edit Manually)

| Key                 | Type     | Description                                                                           |
| ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `zara-first-run`   | sentinel | Set to `"done"` after first launch. Triggers splash screen if absent.                 |
| `zara-app-version` | string   | Last known app version. If it differs from current, splash screen is shown on update. |

## Event System

Zara uses two Tauri events for settings synchronization:

### `settings-changed`

- **Emitted by:** `save_setting` command (frontend or backend)
- **Payload:** `{ "key": "zara-...", "value": ... }`
- **Purpose:** Broadcasts changes made through the Zara UI to all windows
- **Key format:** Zara-prefixed keys as-is (e.g. `"zara-notch-mode"`)

### `settings-external-changed`

- **Emitted by:** File watcher (detects external edits to `settings.json`)
- **Payload:** `{ "key": "zara-...", "value": ... }` or `{ "key": "zara-...", "value": null }` for removed keys
- **Purpose:** Broadcasts changes made by external editors (VS Code, notepad, scripts)
- **Key format:** Zara-prefixed keys as-is
- **Behavior:** Also syncs values to `localStorage` for instant frontend reads

### Flow

```
External editor saves settings.json
    ↓
File watcher detects change (ReadDirectoryChangesW)
    ↓
Diffs against SETTINGS_CACHE
    ↓
Emits settings-external-changed for each changed/removed key
    ↓
useSettingsSync hook updates React state + localStorage
    ↓
useSettingsSync hook updates React state
    ↓
UI re-renders with new values
```

## Notes

- All boolean values are strings (`"true"` / `"false"`) for consistency with `localStorage`.
- The `useSettingsSync` hook auto-converts `"true"` / `"false"` strings to booleans.
- `auto-hide` mode values in `zara-notch-mode` are legacy aliases for `smart` — they are mapped automatically.
- Changing `zara-scale` triggers AppBar re-registration to adjust reserved screen space.
- Settings → General → Reset to Defaults removes every `zara-` key from `settings.json` and `localStorage` (except the `zara-first-run` / `zara-app-version` lifecycle sentinels), then restarts Zara. Pinned apps (`pinned_apps.json`) and uploaded icons (`custom_icons/`) are preserved.
- Theme changes (`zara-theme-*`) are applied by reading all theme values from `localStorage` and calling `applyTheme()` — the theme system depends on all five theme keys being in sync.

## Assistant data (not in settings.json)

| What | Where |
|---|---|
| Notes, conversations, memories, shortcut choices | `%APPDATA%/com.zara.app/ai/*.json` |
| OpenRouter API key | Windows Credential Manager (`Zara` / `openrouter-api-key`) |
