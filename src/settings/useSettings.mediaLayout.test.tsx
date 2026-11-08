import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { useSettings } from "./useSettings";

const savedMediaLayouts = () =>
	invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === "zara-media-layout")
		.map((args) => args.value);

describe("useSettings music layout", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("starts on the classic layout when none was chosen", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.mediaLayout).toBe("classic");
	});

	it("saves the card layout when the user picks it", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.toggleMediaLayout("card"));

		await waitFor(() => expect(savedMediaLayouts()).toEqual(["card"]));
		expect(result.current.mediaLayout).toBe("card");
	});

	it("shows the card layout the notch saved earlier", () => {
		localStorage.setItem("zara-media-layout", "card");
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		expect(result.current.mediaLayout).toBe("card");
	});

	it("falls back to classic for a layout it does not know", () => {
		localStorage.setItem("zara-media-layout", "poster");
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		expect(result.current.mediaLayout).toBe("classic");
	});
});
