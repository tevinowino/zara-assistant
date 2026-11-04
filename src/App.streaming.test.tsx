// While an answer streams in, the conversation changes many times a second. These
// tests pin that only the assistant panel redraws for it, not the whole notch.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInvokeHandler } from "./test/shims/tauriCore";
import { emitTauriEvent } from "./test/shims/tauriEvent";

vi.mock("@tauri-apps/api/webviewWindow", () => {
	const window = new Proxy(
		{ label: "main", isVisible: async () => true },
		{ get: (target, key) => (key in target ? target[key as keyof typeof target] : async () => {}) }
	);
	return { getCurrentWebviewWindow: () => window };
});
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => {} }));
vi.mock("@crabnebula/tauri-plugin-drag", () => ({ startDrag: async () => {} }));

// The notch re-renders this panel every time the notch itself re-renders, so the
// number of times it renders counts how often the notch was redrawn.
const notchRedraws = vi.hoisted(() => ({ count: 0 }));
vi.mock("./notch/views/ControlsPanel", async (importOriginal) => {
	const original = await importOriginal<typeof import("./notch/views/ControlsPanel")>();
	return {
		...original,
		ControlsPanel: (props: Parameters<typeof original.ControlsPanel>[0]) => {
			notchRedraws.count += 1;
			return createElement(original.ControlsPanel, props);
		}
	};
});

import App from "./App";

function registerBackendWithAnAnswerThatNeverFinishes() {
	for (const command of [
		"set_notch_hovered",
		"set_notch_visible",
		"setup_shelf_drop",
		"update_notch_rect",
		"set_window_region",
		"change_notch_mode",
		"set_ignore_cursor_events",
		"set_window_height",
		"sync_appbar",
		"save_setting",
		"shelf_prune",
		"shelf_drag_icon",
		"ai_take_focus",
		"ai_release_focus"
	]) {
		setInvokeHandler(command, () => null);
	}
	setInvokeHandler("load_settings", () => ({}));
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("ai_chat", () => new Promise(() => {}));
}

// How many redraws unrelated to the answer (a clock tick, or the one state change when the
// first chunk arrives) may land while it streams. A runner that is slow enough can fit one or
// two inside the window; a regression costs one redraw for every chunk.
const UNRELATED_REDRAWS_ALLOWED = 2;
const CHUNKS_STREAMED = 12;

describe("the notch while an answer streams in", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		localStorage.setItem("zara-time-format-24h", "true");
		registerBackendWithAnAnswerThatNeverFinishes();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the answer as it arrives without redrawing the notch for every chunk", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await user.click(await screen.findByText(/\d:\d\d/));
		await user.type(
			await screen.findByLabelText("Message Zara", {}, { timeout: 5000 }),
			"hello{Enter}"
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		const redrawsBeforeStreaming = notchRedraws.count;

		let answer = "Once";
		for (let chunk = 0; chunk < CHUNKS_STREAMED; chunk++) {
			answer += " upon";
			emitTauriEvent("ai-chat-delta", answer);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(200);
			});
		}

		expect(await screen.findByText(new RegExp(answer))).toBeInTheDocument();
		expect(notchRedraws.count - redrawsBeforeStreaming).toBeLessThanOrEqual(
			UNRELATED_REDRAWS_ALLOWED
		);
	});
});
