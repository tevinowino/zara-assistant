import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimer } from "./useTimer";
import { playTimerChime } from "./timerChime";

vi.mock("./timerChime", () => ({
	getTimerChimeCtx: vi.fn(),
	playTimerChime: vi.fn()
}));

function renderTimer(overrides: Partial<Parameters<typeof useTimer>[0]> = {}) {
	const triggerEventPeek = vi.fn();
	const view = renderHook(() =>
		useTimer({
			timeFormat24h: true,
			soundEnabled: true,
			notchMode: "fixed",
			triggerEventPeek,
			...overrides
		})
	);
	return { ...view, triggerEventPeek };
}

describe("useTimer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 14, 18, 0, 0));
		localStorage.clear();
		vi.mocked(playTimerChime).mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts idle with a 25 minute timer", () => {
		const { result } = renderTimer();

		expect(result.current.phase).toBe("idle");
		expect(result.current.durationSeconds).toBe(1500);
		expect(result.current.timerSeconds).toBe(0);
	});

	it("starts from the last duration it was used with", () => {
		localStorage.setItem("zara-timer-last-duration", "420");

		const { result } = renderTimer();

		expect(result.current.durationSeconds).toBe(420);
	});

	it("counts down once started", () => {
		const { result } = renderTimer();

		act(() => result.current.start(600));
		act(() => {
			vi.advanceTimersByTime(3000);
		});

		expect(result.current.phase).toBe("running");
		expect(result.current.remainingSeconds).toBe(597);
		expect(result.current.timerSeconds).toBe(597);
	});

	it("shows when a running timer will end", () => {
		const { result } = renderTimer({ timeFormat24h: true });

		act(() => result.current.start(600));

		expect(result.current.endsAtLabel).toBe("18:10");
	});

	it("has no end time while idle", () => {
		const { result } = renderTimer();

		expect(result.current.endsAtLabel).toBeNull();
	});

	it("shrinks the progress ring as time passes", () => {
		const { result } = renderTimer();

		act(() => result.current.start(100));
		act(() => {
			vi.advanceTimersByTime(25_000);
		});

		expect(result.current.remainingFraction).toBeCloseTo(0.75, 2);
	});

	it("holds the time while paused and carries on when resumed", () => {
		const { result } = renderTimer();
		act(() => result.current.start(600));
		act(() => {
			vi.advanceTimersByTime(10_000);
		});

		act(() => result.current.pause());
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(result.current.phase).toBe("paused");
		expect(result.current.remainingSeconds).toBe(590);

		act(() => result.current.resume());
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(result.current.phase).toBe("running");
		expect(result.current.remainingSeconds).toBe(585);
	});

	it("finishes at zero and chimes once", () => {
		const { result } = renderTimer();

		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(result.current.phase).toBe("finished");
		expect(result.current.isTimerFinished).toBe(true);
		expect(result.current.timerSeconds).toBe(0);
		expect(playTimerChime).toHaveBeenCalledTimes(1);
	});

	it("does not chime when sound is off", () => {
		const { result } = renderTimer({ soundEnabled: false });

		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(result.current.phase).toBe("finished");
		expect(playTimerChime).not.toHaveBeenCalled();
	});

	it("reveals the notch for six seconds in peek mode when it finishes", () => {
		const { result, triggerEventPeek } = renderTimer({ notchMode: "peek" });

		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(triggerEventPeek).toHaveBeenCalledWith(6000);
	});

	it("does not reveal the notch outside peek mode", () => {
		const { result, triggerEventPeek } = renderTimer({ notchMode: "fixed" });

		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(triggerEventPeek).not.toHaveBeenCalled();
	});

	it("finishes on time after the window was suspended and the clock jumped", () => {
		const { result } = renderTimer();
		act(() => result.current.start(600));

		act(() => {
			vi.setSystemTime(new Date(2026, 10, 14, 18, 30, 0));
			vi.advanceTimersByTime(250);
		});

		expect(result.current.phase).toBe("finished");
	});

	it("goes back to idle on cancel, keeping the length", () => {
		const { result } = renderTimer();
		act(() => result.current.start(900));

		act(() => result.current.cancel());

		expect(result.current.phase).toBe("idle");
		expect(result.current.durationSeconds).toBe(900);
		expect(result.current.timerSeconds).toBe(0);
	});

	it("goes back to idle on the notch's reset, which dismisses a finished timer", () => {
		const { result } = renderTimer();
		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		act(() => result.current.resetTimer());

		expect(result.current.phase).toBe("idle");
	});

	it("starts again for the same length with no argument", () => {
		const { result } = renderTimer();
		act(() => result.current.start(5));
		act(() => {
			vi.advanceTimersByTime(5000);
		});

		act(() => result.current.start());

		expect(result.current.phase).toBe("running");
		expect(result.current.remainingSeconds).toBe(5);
	});

	it("changes the length while idle and remembers it", () => {
		const { result } = renderTimer();

		act(() => result.current.setDuration(2700));

		expect(result.current.durationSeconds).toBe(2700);
		expect(localStorage.getItem("zara-timer-last-duration")).toBe("2700");
	});

	it("ignores a length change while the timer is running", () => {
		const { result } = renderTimer();
		act(() => result.current.start(600));

		act(() => result.current.setDuration(60));

		expect(result.current.durationSeconds).toBe(600);
	});

	it("remembers a custom length as a recent one", () => {
		const { result } = renderTimer();

		act(() => result.current.start(420));

		expect(result.current.recentDurations).toEqual([420]);
		expect(localStorage.getItem("zara-timer-recent-durations")).toBe("[420]");
	});

	it("does not remember a preset length as a recent one", () => {
		const { result } = renderTimer();

		act(() => result.current.start(25 * 60));

		expect(result.current.recentDurations).toEqual([]);
	});

	it("loads the recent lengths saved earlier", () => {
		localStorage.setItem("zara-timer-recent-durations", "[420,90]");

		const { result } = renderTimer();

		expect(result.current.recentDurations).toEqual([420, 90]);
	});

	it("formats the collapsed notch's time as minutes and seconds", () => {
		const { result } = renderTimer();

		expect(result.current.formatTimerTime(4500)).toBe("75:00");
	});
});
