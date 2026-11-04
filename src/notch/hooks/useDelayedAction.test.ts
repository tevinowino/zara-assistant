import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedAction } from "./useDelayedAction";

describe("useDelayedAction", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs the action once the delay has passed, not before", () => {
		const action = vi.fn();
		const { result } = renderHook(() => useDelayedAction(1200));

		act(() => result.current.schedule(action));
		act(() => {
			vi.advanceTimersByTime(1199);
		});
		expect(action).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(action).toHaveBeenCalledTimes(1);
	});

	it("does not run a cancelled action", () => {
		const action = vi.fn();
		const { result } = renderHook(() => useDelayedAction(1200));
		act(() => result.current.schedule(action));

		act(() => result.current.cancel());
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(action).not.toHaveBeenCalled();
	});

	it("keeps the first deadline when scheduled again while waiting", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { result } = renderHook(() => useDelayedAction(1000));
		act(() => result.current.schedule(first));
		act(() => {
			vi.advanceTimersByTime(600);
		});

		act(() => result.current.schedule(second));
		act(() => {
			vi.advanceTimersByTime(400);
		});

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
	});

	it("can be scheduled again after it has run", () => {
		const action = vi.fn();
		const { result } = renderHook(() => useDelayedAction(500));
		act(() => result.current.schedule(action));
		act(() => {
			vi.advanceTimersByTime(500);
		});

		act(() => result.current.schedule(action));
		act(() => {
			vi.advanceTimersByTime(500);
		});

		expect(action).toHaveBeenCalledTimes(2);
	});

	it("drops a pending action when the component using it goes away", () => {
		const action = vi.fn();
		const { result, unmount } = renderHook(() => useDelayedAction(500));
		act(() => result.current.schedule(action));

		unmount();
		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(action).not.toHaveBeenCalled();
	});
});
