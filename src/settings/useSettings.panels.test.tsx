import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { useSettings } from "./useSettings";

function savedPanelChoices(): unknown[] {
	return invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === "zara-notch-panels")
		.map((args) => JSON.parse(args.value));
}

describe("useSettings widgets", () => {
	it("starts with the assistant, the calendar and the command center on", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.notchPanels.enabled).toEqual(["ai", "calendar", "command-center"]);
	});

	it("keeps the panels the old per-panel settings had on", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-devices-enabled": "true",
			"zara-calendar-enabled": "false"
		}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() =>
			expect(result.current.notchPanels.enabled).toEqual(["ai", "command-center", "devices"])
		);
	});

	it("loads a saved choice and its order", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-panels": JSON.stringify(["notes", "ai", "weather"])
		}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() =>
			expect(result.current.notchPanels.enabled).toEqual(["notes", "ai", "weather"])
		);
	});

	it("saves the whole choice when a widget is turned on", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.setNotchPanelEnabled("notes", true));

		await waitFor(() =>
			expect(savedPanelChoices()).toEqual([["ai", "calendar", "command-center", "notes"]])
		);
		expect(result.current.notchPanels.enabled).toContain("notes");
	});

	it("saves the whole choice when a widget is turned off", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.setNotchPanelEnabled("calendar", false));

		await waitFor(() => expect(savedPanelChoices()).toEqual([["ai", "command-center"]]));
	});

	it("will not turn off the last widget", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-notch-panels": JSON.stringify(["ai"])
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.notchPanels.enabled).toEqual(["ai"]));

		act(() => result.current.setNotchPanelEnabled("ai", false));

		expect(result.current.notchPanels.enabled).toEqual(["ai"]);
		expect(savedPanelChoices()).toEqual([]);
	});

	it("saves a new order when a widget is moved", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.moveNotchPanel("command-center", -1));

		await waitFor(() =>
			expect(savedPanelChoices()).toEqual([["ai", "command-center", "calendar"]])
		);
	});

	it("saves nothing when a move changes nothing", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.moveNotchPanel("ai", -1));

		expect(savedPanelChoices()).toEqual([]);
	});

	it("follows a change made from another window", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-notch-panels",
			value: JSON.stringify(["weather", "notes"])
		});

		await waitFor(() => expect(result.current.notchPanels.enabled).toEqual(["weather", "notes"]));
	});

	it("can name any widget as the default panel", async () => {
		setInvokeHandler("load_settings", () => ({ "zara-notch-default-panel": "notes" }));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.notchDefaultPanel).toBe("notes"));
	});
});
