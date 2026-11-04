import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async (_command: string) => null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { KEYBOARD_FOCUS_DELAY_MS, useDeferredKeyboardFocus } from "./useDeferredKeyboardFocus";

const commandsSent = () => invoke.mock.calls.map((call) => call[0]);

describe("useDeferredKeyboardFocus", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		// Unmount first: a hook still holding focus releases it, which must not leak into the next test.
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("does not take focus in the first frames after it is wanted", () => {
		renderHook(() => useDeferredKeyboardFocus(true, true));

		vi.advanceTimersByTime(KEYBOARD_FOCUS_DELAY_MS - 1);

		expect(commandsSent()).toEqual([]);
	});

	it("takes focus once the delay has passed", () => {
		renderHook(() => useDeferredKeyboardFocus(true, true));

		vi.advanceTimersByTime(KEYBOARD_FOCUS_DELAY_MS);

		expect(commandsSent()).toEqual(["ai_take_focus"]);
	});

	it("gives focus back when it stops being wanted after it was taken", () => {
		const { rerender } = renderHook(({ wanted }) => useDeferredKeyboardFocus(wanted, true), {
			initialProps: { wanted: true }
		});
		vi.advanceTimersByTime(KEYBOARD_FOCUS_DELAY_MS);

		rerender({ wanted: false });

		expect(commandsSent()).toEqual(["ai_take_focus", "ai_release_focus"]);
	});

	it("sends nothing at all when it stops being wanted before the delay passed", () => {
		const { rerender } = renderHook(({ wanted }) => useDeferredKeyboardFocus(wanted, true), {
			initialProps: { wanted: true }
		});
		vi.advanceTimersByTime(KEYBOARD_FOCUS_DELAY_MS - 1);

		rerender({ wanted: false });
		vi.advanceTimersByTime(1000);

		expect(commandsSent()).toEqual([]);
	});

	it("gives focus back when the notch goes away while holding it", () => {
		const { unmount } = renderHook(() => useDeferredKeyboardFocus(true, true));
		vi.advanceTimersByTime(KEYBOARD_FOCUS_DELAY_MS);

		unmount();

		expect(commandsSent()).toEqual(["ai_take_focus", "ai_release_focus"]);
	});

	it("never touches focus when disabled", () => {
		renderHook(() => useDeferredKeyboardFocus(true, false));

		vi.advanceTimersByTime(1000);

		expect(commandsSent()).toEqual([]);
	});
});
