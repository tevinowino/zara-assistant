import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { useSettings } from "./useSettings";

function savedFollowCursorValues(): string[] {
	return invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === "zara-notch-follow-cursor")
		.map((args) => args.value);
}

describe("useSettings follow cursor", () => {
	it("follows the cursor by default", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.notchFollowsCursor).toBe(true);
	});

	it("does not follow the cursor when the saved setting says false", async () => {
		setInvokeHandler("load_settings", () => ({ "zara-notch-follow-cursor": "false" }));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.notchFollowsCursor).toBe(false));
	});

	it("saves false when it is turned off, and true when it is turned back on", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.toggleNotchFollowsCursor());
		await waitFor(() => expect(result.current.notchFollowsCursor).toBe(false));
		act(() => result.current.toggleNotchFollowsCursor());
		await waitFor(() => expect(result.current.notchFollowsCursor).toBe(true));

		expect(savedFollowCursorValues()).toEqual(["false", "true"]);
	});

	it("follows a change made in another window", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => emitTauriEvent("settings-changed", { key: "zara-notch-follow-cursor", value: "false" }));

		await waitFor(() => expect(result.current.notchFollowsCursor).toBe(false));
	});
});
