import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// A Tauri command written as a plain `fn` runs on the UI thread, the same thread
// that animates the notch, so anything slow in it (disk, the credential store,
// a device scan, waiting on a lock another command holds) shows up as a
// stutter. A command that may be slow must be `async` and do its work on a
// blocking-pool thread (see `on_blocking_thread` in src-tauri/src/ai/mod.rs and
// `get_system_metrics` in commands.rs).
//
// This test keeps new plain `fn` commands from slipping in. Every one that is
// allowed is named below, with the reason it is acceptable.

const rustSourceDirectory = resolve(import.meta.dir, "..", "src-tauri", "src");

function rustFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) return rustFiles(full);
		return full.endsWith(".rs") ? [full] : [];
	});
}

/** Names of the commands declared as `#[tauri::command] pub fn name` (not `async`). */
function synchronousCommands(): string[] {
	return rustFiles(rustSourceDirectory).flatMap((file) =>
		[...readFileSync(file, "utf8").matchAll(/#\[tauri::command\]\s*pub fn ([a-z_0-9]+)/g)].map(
			(match) => match[1]
		)
	);
}

/** Windows and the notch's own state: they must run on the UI thread or only touch atomics and channels. */
const cheapOrUiBound = [
	"ai_cancel_chat",
	"ai_get_model_controls",
	"bluetooth_pairing_respond",
	"clear_volume_mixer_rect",
	"set_volume_mixer_rect",
	"get_brightness",
	"get_volume",
	"set_brightness",
	"set_volume",
	"hide_native_osd",
	"hide_overlay",
	"set_splash_fullscreen",
	"sync_overlay_position",
	"resize_settings_window",
	"open_settings_window",
	"set_ignore_cursor_events",
	"set_window_height",
	"set_window_region",
	"setup_shelf_drop",
	"shelf_drag_icon",
	"media_next",
	"media_play_pause",
	"media_previous",
	"media_seek",
	"open_media_source_app",
	"open_airplane_mode_settings",
	"open_battery_saver_settings",
	"open_bluetooth_settings",
	"open_notification_center",
	"open_sound_settings",
	"open_system_tray",
	"open_wifi_settings",
	"wifi_open_settings",
	"jack_list_devices",
	"usb_list_devices"
];

/**
 * Plain `fn` commands that read files, the registry or hotkey tables and have
 * not yet been checked for slowness. New commands must not be added here: make
 * them `async` instead, and move one of these out when it has been looked at.
 */
const stillToReview = [
	"get_system_accent_color",
	"get_windows_accent_color",
	"load_settings",
	"reset_settings",
	"settings_file_readable",
	"shortcut_active",
	"shortcut_list",
	"shortcut_reset",
	"shortcut_set",
	"stealth_set",
	"stealth_status",
	"stealth_verify"
];

describe("commands that run on the UI thread", () => {
	test("every plain `fn` command is one that has been looked at", () => {
		const allowed = new Set([...cheapOrUiBound, ...stillToReview]);

		const unreviewed = synchronousCommands().filter((name) => !allowed.has(name));

		expect(unreviewed).toEqual([]);
	});

	test("the allow-list names no command that no longer exists as a plain `fn`", () => {
		const existing = new Set(synchronousCommands());

		const stale = [...cheapOrUiBound, ...stillToReview].filter((name) => !existing.has(name));

		expect(stale).toEqual([]);
	});

	test("the commands that read disk or the credential store are async", () => {
		const slowCommands = [
			"conv_save",
			"conv_list",
			"ai_get_settings",
			"ai_has_api_key",
			"get_system_metrics"
		];

		const stillSynchronous = slowCommands.filter((name) => synchronousCommands().includes(name));

		expect(stillSynchronous).toEqual([]);
	});
});
