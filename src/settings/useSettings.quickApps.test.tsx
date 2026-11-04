import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { useSettings } from "./useSettings";

const spotify = { name: "Spotify", target: "C:\\Apps\\Spotify.lnk" };
const notepad = { name: "Notepad", target: "C:\\Apps\\Notepad.lnk" };

function savedQuickApps(): unknown[] {
	return invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === "zara-quick-apps")
		.map((args) => JSON.parse(args.value));
}

describe("useSettings pinned apps", () => {
	it("starts with no apps pinned", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.quickApps).toEqual([]);
	});

	it("loads the saved apps", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-quick-apps": JSON.stringify([spotify, notepad])
		}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.quickApps).toEqual([spotify, notepad]));
	});

	it("saves the whole list when an app is pinned", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.pinQuickApp(spotify));

		await waitFor(() => expect(savedQuickApps()).toEqual([[spotify]]));
		expect(result.current.quickApps).toEqual([spotify]);
	});

	it("saves nothing when the app is already pinned", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-quick-apps": JSON.stringify([spotify])
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.quickApps).toHaveLength(1));

		act(() => result.current.pinQuickApp(spotify));

		expect(savedQuickApps()).toEqual([]);
	});

	it("will not pin a fifth app", async () => {
		const four = ["a", "b", "c", "d"].map((name) => ({ name, target: `C:\\${name}.lnk` }));
		setInvokeHandler("load_settings", () => ({ "zara-quick-apps": JSON.stringify(four) }));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.quickApps).toHaveLength(4));

		act(() => result.current.pinQuickApp(spotify));

		expect(result.current.quickApps).toHaveLength(4);
		expect(savedQuickApps()).toEqual([]);
	});

	it("saves the list without an app that was unpinned", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-quick-apps": JSON.stringify([spotify, notepad])
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.quickApps).toHaveLength(2));

		act(() => result.current.unpinQuickApp(spotify.target));

		await waitFor(() => expect(savedQuickApps()).toEqual([[notepad]]));
	});

	it("saves a new order when an app is moved", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-quick-apps": JSON.stringify([spotify, notepad])
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.quickApps).toHaveLength(2));

		act(() => result.current.moveQuickApp(notepad.target, -1));

		await waitFor(() => expect(savedQuickApps()).toEqual([[notepad, spotify]]));
	});

	it("follows a change made from another window", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-quick-apps",
			value: JSON.stringify([notepad])
		});

		await waitFor(() => expect(result.current.quickApps).toEqual([notepad]));
	});
});
