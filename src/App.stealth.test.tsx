// The notch shows when stealth mode is on: a dotted rim just inside its edge and a mask
// beside the clock. These tests render the real notch and drive the backend's answer.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInvokeHandler } from "./test/shims/tauriCore";
import type { StealthStatus } from "./ai/api";

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

import App from "./App";

function registerQuietBackend(stealth: StealthStatus) {
	setInvokeHandler("load_settings", () => ({}));
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
		"shelf_drag_icon"
	]) {
		setInvokeHandler(command, () => null);
	}
	setInvokeHandler("stealth_status", () => stealth);
}

const base: StealthStatus = {
	requested: false,
	supported: true,
	active: false,
	problem: null,
	windows: []
};

describe("the notch while stealth mode is on", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		localStorage.setItem("zara-time-format-24h", "true");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("draws the dotted rim and the badge when stealth is holding", async () => {
		registerQuietBackend({ ...base, requested: true, active: true });
		const { container } = render(<App />);

		expect(
			await screen.findByRole("img", {
				name: "Stealth mode is on: Zara is hidden from screen capture"
			})
		).toBeInTheDocument();
		expect(container.querySelector(".stealth-rim")).toHaveAttribute("data-state", "active");
		expect(container.querySelector(".zara")).toHaveClass("stealth-on");
	});

	it("marks it as a problem when stealth was asked for but is not holding", async () => {
		registerQuietBackend({
			...base,
			requested: true,
			active: false,
			problem: "One window could not be hidden."
		});
		const { container } = render(<App />);

		expect(
			await screen.findByRole("img", {
				name: "Stealth mode is on but not holding: One window could not be hidden."
			})
		).toBeInTheDocument();
		expect(container.querySelector(".stealth-rim")).toHaveAttribute("data-state", "problem");
	});

	it("shows nothing extra when stealth is off", async () => {
		registerQuietBackend(base);
		const { container } = render(<App />);
		await screen.findByText(/\d:\d\d/);

		await waitFor(() => expect(container.querySelector(".zara")).not.toBeNull());
		expect(container.querySelector(".stealth-rim")).not.toBeInTheDocument();
		expect(screen.queryByRole("img", { name: /Stealth mode/ })).not.toBeInTheDocument();
		expect(container.querySelector(".zara")).not.toHaveClass("stealth-on");
	});
});
