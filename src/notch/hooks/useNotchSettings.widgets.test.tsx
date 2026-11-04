import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.2.0" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
	isEnabled: async () => true,
	enable: async () => {}
}));

import { useNotchSettings } from "./useNotchSettings";

const notepad = { name: "Notepad", target: "C:\\Apps\\Notepad.lnk" };

describe("useNotchSettings widgets and pinned apps", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("starts with the assistant, calendar and command center, and no pinned apps", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));

		expect(result.current.panelPreferences.enabled).toEqual(["ai", "calendar", "command-center"]);
		expect(result.current.quickApps).toEqual([]);
		await waitFor(() => expect(result.current.systemSettingsReady).toBe(true));
	});

	it("reads the user's chosen widgets, in their order, from the saved settings", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-panels": JSON.stringify(["notes", "weather", "ai"])
		}));

		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));

		await waitFor(() =>
			expect(result.current.panelPreferences.enabled).toEqual(["notes", "weather", "ai"])
		);
	});

	it("keeps the panels the old per-panel settings had on", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-devices-enabled": "true",
			"zara-notch-ai-enabled": "false"
		}));

		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));

		await waitFor(() =>
			expect(result.current.panelPreferences.enabled).toEqual([
				"calendar",
				"command-center",
				"devices"
			])
		);
	});

	it("tells the calendar and devices flags apart from the widget list", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-panels": JSON.stringify(["calendar", "devices"])
		}));

		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));

		await waitFor(() => expect(result.current.settingsDevicesPanelEnabled).toBe(true));
		expect(result.current.settingsCalendarEnabled).toBe(true);
	});

	it("follows a change of widgets made in Settings", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));
		await waitFor(() => expect(result.current.systemSettingsReady).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-notch-panels",
			value: JSON.stringify(["clipboard", "command-center"])
		});

		await waitFor(() =>
			expect(result.current.panelPreferences.enabled).toEqual(["clipboard", "command-center"])
		);
	});

	it("reads the pinned apps from the saved settings", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-quick-apps": JSON.stringify([notepad])
		}));

		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));

		await waitFor(() => expect(result.current.quickApps).toEqual([notepad]));
	});

	it("follows a change of pinned apps made in Settings", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useNotchSettings({ windowLabel: "main" }));
		await waitFor(() => expect(result.current.systemSettingsReady).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-quick-apps",
			value: JSON.stringify([notepad])
		});

		await waitFor(() => expect(result.current.quickApps).toEqual([notepad]));
	});
});
