import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import {
	COMPACT_BELOW_PX,
	WIDE_FROM_PX,
	settingsWidthFor,
	useSettingsWidth,
	useSettingsWindowSize
} from "./useSettingsLayout";

function resizeWindowTo(width: number) {
	window.innerWidth = width;
	window.dispatchEvent(new Event("resize"));
}

const resizeCalls = () => invokeCalls.filter((call) => call.command === "resize_settings_window");

describe("settingsWidthFor", () => {
	it("is compact just below the compact limit", () => {
		expect(settingsWidthFor(COMPACT_BELOW_PX - 1)).toBe("compact");
	});

	it("is regular from the compact limit", () => {
		expect(settingsWidthFor(COMPACT_BELOW_PX)).toBe("regular");
	});

	it("is regular just below the wide limit", () => {
		expect(settingsWidthFor(WIDE_FROM_PX - 1)).toBe("regular");
	});

	it("is wide from the wide limit", () => {
		expect(settingsWidthFor(WIDE_FROM_PX)).toBe("wide");
	});

	it("is compact for a very small window", () => {
		expect(settingsWidthFor(320)).toBe("compact");
	});
});

describe("useSettingsWidth", () => {
	afterEach(() => {
		window.innerWidth = 1024;
	});

	it("starts from the window's width", () => {
		window.innerWidth = 900;

		const { result } = renderHook(() => useSettingsWidth(1));

		expect(result.current).toBe("regular");
	});

	it("counts the UI scale against the window, since the scale zooms everything", () => {
		window.innerWidth = 900;

		const { result } = renderHook(() => useSettingsWidth(1.3));

		// 900 / 1.3 is about 692px to lay out.
		expect(result.current).toBe("compact");
	});

	it("follows the window as it is resized", () => {
		window.innerWidth = 900;
		const { result } = renderHook(() => useSettingsWidth(1));

		act(() => resizeWindowTo(640));
		expect(result.current).toBe("compact");

		act(() => resizeWindowTo(1300));
		expect(result.current).toBe("wide");
	});

	it("updates when the scale changes", () => {
		window.innerWidth = 900;
		const { result, rerender } = renderHook(({ scale }) => useSettingsWidth(scale), {
			initialProps: { scale: 1 }
		});
		expect(result.current).toBe("regular");

		rerender({ scale: 1.3 });

		expect(result.current).toBe("compact");
	});

	it("stops listening when unmounted", () => {
		const removeListener = vi.spyOn(window, "removeEventListener");
		const { unmount } = renderHook(() => useSettingsWidth(1));

		unmount();

		expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
		removeListener.mockRestore();
	});
});

describe("useSettingsWindowSize", () => {
	it("leaves the window at its configured size when opened at 100%", () => {
		setInvokeHandler("resize_settings_window", () => null);

		renderHook(() => useSettingsWindowSize(1));

		expect(resizeCalls()).toHaveLength(0);
	});

	it("sizes the window for the scale when opened at another scale", () => {
		setInvokeHandler("resize_settings_window", () => null);

		renderHook(() => useSettingsWindowSize(1.2));

		expect(resizeCalls()).toHaveLength(1);
		expect(resizeCalls()[0].args).toEqual({ width: 900 * 1.2, height: 640 * 1.2 });
	});

	it("resizes the window when the scale changes", () => {
		setInvokeHandler("resize_settings_window", () => null);
		const { rerender } = renderHook(({ scale }) => useSettingsWindowSize(scale), {
			initialProps: { scale: 1 }
		});

		rerender({ scale: 1.3 });

		expect(resizeCalls()).toHaveLength(1);
		expect(resizeCalls()[0].args).toEqual({ width: 900 * 1.3, height: 640 * 1.3 });
	});

	it("goes back to the base size when the scale returns to 100%", () => {
		setInvokeHandler("resize_settings_window", () => null);
		const { rerender } = renderHook(({ scale }) => useSettingsWindowSize(scale), {
			initialProps: { scale: 1.3 }
		});

		rerender({ scale: 1 });

		expect(resizeCalls().at(-1)?.args).toEqual({ width: 900, height: 640 });
	});

	it("does not resize again when it renders again with the same scale", () => {
		setInvokeHandler("resize_settings_window", () => null);
		const { rerender } = renderHook(({ scale }) => useSettingsWindowSize(scale), {
			initialProps: { scale: 1 }
		});

		rerender({ scale: 1 });
		rerender({ scale: 1 });

		expect(resizeCalls()).toHaveLength(0);
	});

	it("reports a failed resize without crashing", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		setInvokeHandler("resize_settings_window", () => {
			throw new Error("no window");
		});

		renderHook(() => useSettingsWindowSize(1.2));
		await vi.waitFor(() => expect(logged).toHaveBeenCalled());

		logged.mockRestore();
	});
});
