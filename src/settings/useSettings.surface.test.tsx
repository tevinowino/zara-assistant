import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { useSettings } from "./useSettings";

function savedValuesFor(key: string): unknown[] {
	return invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === key)
		.map((args) => JSON.parse(args.value));
}

describe("useSettings glass", () => {
	it("starts with glass off and the default look", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.glass).toEqual({
			enabled: false,
			edgeShine: 0.6,
			sheen: 0.5,
			edgeWidthPx: 1.5,
			frost: 0.2,
			dispersion: 0.3,
			depth: 0.4
		});
	});

	it("loads the saved glass look", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-glass": JSON.stringify({
				enabled: true,
				edgeShine: 0.9,
				sheen: 0.1,
				edgeWidthPx: 3,
				frost: 0.7,
				dispersion: 0.2,
				depth: 0.6
			})
		}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.glass.enabled).toBe(true));
		expect(result.current.glass).toEqual({
			enabled: true,
			edgeShine: 0.9,
			sheen: 0.1,
			edgeWidthPx: 3,
			frost: 0.7,
			dispersion: 0.2,
			depth: 0.6
		});
	});

	it("saves the whole look when one option changes, keeping the others", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-glass": JSON.stringify({
				enabled: true,
				edgeShine: 0.9,
				sheen: 0.1,
				edgeWidthPx: 3,
				frost: 0.7,
				dispersion: 0.2,
				depth: 0.6
			})
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.glass.enabled).toBe(true));

		act(() => result.current.handleGlassChange({ frost: 0.1 }));

		await waitFor(() =>
			expect(savedValuesFor("zara-glass")).toEqual([
				{
					enabled: true,
					edgeShine: 0.9,
					sheen: 0.1,
					edgeWidthPx: 3,
					frost: 0.1,
					dispersion: 0.2,
					depth: 0.6
				}
			])
		);
		expect(result.current.glass.frost).toBe(0.1);
	});

	it("never saves a value outside the allowed range", async () => {
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		act(() => result.current.handleGlassChange({ edgeShine: 5, edgeWidthPx: 0, depth: -1 }));

		await waitFor(() =>
			expect(savedValuesFor("zara-glass")).toEqual([
				{
					enabled: false,
					edgeShine: 1,
					sheen: 0.5,
					edgeWidthPx: 1,
					frost: 0.2,
					dispersion: 0.3,
					depth: 0
				}
			])
		);
	});

	it("follows a change made from another window", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-glass",
			value: JSON.stringify({
				enabled: true,
				edgeShine: 0.4,
				sheen: 0.4,
				edgeWidthPx: 2,
				frost: 0.4,
				dispersion: 0.4,
				depth: 0.4
			})
		});

		await waitFor(() => expect(result.current.glass.enabled).toBe(true));
		expect(result.current.glass.edgeShine).toBe(0.4);
	});
});

describe("useSettings glow", () => {
	it("starts with the glow off, following the theme accent", async () => {
		setInvokeHandler("load_settings", () => ({}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.isLoaded).toBe(true));
		expect(result.current.glow).toEqual({ enabled: false, color: null, intensity: 0.5 });
	});

	it("loads the saved glow", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-glow": JSON.stringify({ enabled: true, color: "#ff7a59", intensity: 0.9 })
		}));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => expect(result.current.glow.enabled).toBe(true));
		expect(result.current.glow).toEqual({ enabled: true, color: "#ff7a59", intensity: 0.9 });
	});

	it("saves the whole glow when one option changes, keeping the others", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-glow": JSON.stringify({ enabled: true, color: "#ff7a59", intensity: 0.9 })
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.glow.enabled).toBe(true));

		act(() => result.current.handleGlowChange({ intensity: 0.3 }));

		await waitFor(() =>
			expect(savedValuesFor("zara-glow")).toEqual([
				{ enabled: true, color: "#ff7a59", intensity: 0.3 }
			])
		);
	});

	it("goes back to following the theme when the colour is cleared", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-glow": JSON.stringify({ enabled: true, color: "#ff7a59", intensity: 0.9 })
		}));
		setInvokeHandler("save_setting", () => undefined);
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.glow.color).toBe("#ff7a59"));

		act(() => result.current.handleGlowChange({ color: null }));

		await waitFor(() =>
			expect(savedValuesFor("zara-glow")).toEqual([{ enabled: true, color: null, intensity: 0.9 }])
		);
	});

	it("follows a change made from another window", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.isLoaded).toBe(true));

		emitTauriEvent("settings-changed", {
			key: "zara-glow",
			value: JSON.stringify({ enabled: true, color: "#22c55e", intensity: 0.2 })
		});

		await waitFor(() => expect(result.current.glow.color).toBe("#22c55e"));
	});
});
