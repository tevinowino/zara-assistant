import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";
import { useCardLyricsPreference } from "./useCardLyricsPreference";

const savedValues = () =>
	invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === "zara-card-lyrics")
		.map((args) => args.value);

describe("useCardLyricsPreference", () => {
	beforeEach(() => {
		localStorage.clear();
		setInvokeHandler("save_setting", () => undefined);
	});

	it("starts with the lyrics off, so nothing is looked up until the user asks", () => {
		const { result } = renderHook(() => useCardLyricsPreference());

		expect(result.current.shown).toBe(false);
	});

	it("starts with the lyrics on when the user left them on", () => {
		localStorage.setItem("zara-card-lyrics", "true");

		const { result } = renderHook(() => useCardLyricsPreference());

		expect(result.current.shown).toBe(true);
	});

	it("turns the lyrics on and saves it", () => {
		const { result } = renderHook(() => useCardLyricsPreference());

		act(() => result.current.toggle());

		expect(result.current.shown).toBe(true);
		expect(savedValues()).toEqual(["true"]);
	});

	it("turns the lyrics off again and saves it", () => {
		localStorage.setItem("zara-card-lyrics", "true");
		const { result } = renderHook(() => useCardLyricsPreference());

		act(() => result.current.toggle());

		expect(result.current.shown).toBe(false);
		expect(savedValues()).toEqual(["false"]);
	});

	it("follows a change made in another window", async () => {
		const { result } = renderHook(() => useCardLyricsPreference());

		await act(async () => {
			emitTauriEvent("settings-changed", { key: "zara-card-lyrics", value: "true" });
		});

		expect(result.current.shown).toBe(true);
	});
});
