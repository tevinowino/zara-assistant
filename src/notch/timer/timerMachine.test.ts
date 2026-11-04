import { describe, expect, it } from "vitest";
import {
	initialTimerState,
	remainingFraction,
	remainingSeconds,
	transition,
	type TimerState
} from "./timerMachine";

describe("initialTimerState", () => {
	it("is idle with the given length", () => {
		expect(initialTimerState(1500)).toEqual({ phase: "idle", durationSeconds: 1500 });
	});

	it("holds a length over three hours to three hours", () => {
		expect(initialTimerState(99999).durationSeconds).toBe(10800);
	});
});

describe("transition: set-duration", () => {
	it("changes the length while idle", () => {
		const idle: TimerState = { phase: "idle", durationSeconds: 1500 };

		expect(transition(idle, { type: "set-duration", seconds: 600 })).toEqual({
			phase: "idle",
			durationSeconds: 600
		});
	});

	it("is ignored while a timer is running", () => {
		const running: TimerState = { phase: "running", durationSeconds: 1500, endsAtMs: 5000 };

		expect(transition(running, { type: "set-duration", seconds: 600 })).toBe(running);
	});
});

describe("transition: start", () => {
	it("runs for the length the wheels show", () => {
		const idle: TimerState = { phase: "idle", durationSeconds: 1500 };

		expect(transition(idle, { type: "start", nowMs: 10_000 })).toEqual({
			phase: "running",
			durationSeconds: 1500,
			endsAtMs: 10_000 + 1500 * 1000
		});
	});

	it("runs for a length given in the event and remembers it", () => {
		const idle: TimerState = { phase: "idle", durationSeconds: 1500 };

		expect(transition(idle, { type: "start", nowMs: 0, seconds: 300 })).toEqual({
			phase: "running",
			durationSeconds: 300,
			endsAtMs: 300_000
		});
	});

	it("does not start a zero-length timer", () => {
		const idle: TimerState = { phase: "idle", durationSeconds: 0 };

		expect(transition(idle, { type: "start", nowMs: 0 })).toBe(idle);
	});

	it("restarts a finished timer for the same length", () => {
		const finished: TimerState = { phase: "finished", durationSeconds: 600 };

		expect(transition(finished, { type: "start", nowMs: 1000 })).toEqual({
			phase: "running",
			durationSeconds: 600,
			endsAtMs: 601_000
		});
	});
});

describe("transition: pause and resume", () => {
	it("pauses with the time that was left", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(transition(running, { type: "pause", nowMs: 45_500 })).toEqual({
			phase: "paused",
			durationSeconds: 60,
			remainingMs: 14_500
		});
	});

	it("resumes so that the same time is left", () => {
		const paused: TimerState = { phase: "paused", durationSeconds: 60, remainingMs: 14_500 };

		expect(transition(paused, { type: "resume", nowMs: 100_000 })).toEqual({
			phase: "running",
			durationSeconds: 60,
			endsAtMs: 114_500
		});
	});

	it("does not pause an idle timer", () => {
		const idle: TimerState = { phase: "idle", durationSeconds: 60 };

		expect(transition(idle, { type: "pause", nowMs: 0 })).toBe(idle);
	});

	it("does not resume a timer that is not paused", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(transition(running, { type: "resume", nowMs: 1 })).toBe(running);
	});
});

describe("transition: cancel", () => {
	it("returns a running timer to idle, keeping its length", () => {
		const running: TimerState = { phase: "running", durationSeconds: 900, endsAtMs: 5000 };

		expect(transition(running, { type: "cancel" })).toEqual({
			phase: "idle",
			durationSeconds: 900
		});
	});

	it("returns a paused timer to idle", () => {
		const paused: TimerState = { phase: "paused", durationSeconds: 900, remainingMs: 4000 };

		expect(transition(paused, { type: "cancel" }).phase).toBe("idle");
	});

	it("returns a finished timer to idle", () => {
		const finished: TimerState = { phase: "finished", durationSeconds: 900 };

		expect(transition(finished, { type: "cancel" })).toEqual({
			phase: "idle",
			durationSeconds: 900
		});
	});
});

describe("transition: tick", () => {
	it("keeps running before the end time", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(transition(running, { type: "tick", nowMs: 59_999 })).toBe(running);
	});

	it("finishes exactly at the end time", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(transition(running, { type: "tick", nowMs: 60_000 })).toEqual({
			phase: "finished",
			durationSeconds: 60
		});
	});

	it("finishes when the window was suspended past the end time", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(transition(running, { type: "tick", nowMs: 5_000_000 }).phase).toBe("finished");
	});

	it("does not finish a paused timer however much time passes", () => {
		const paused: TimerState = { phase: "paused", durationSeconds: 60, remainingMs: 10_000 };

		expect(transition(paused, { type: "tick", nowMs: 5_000_000 })).toBe(paused);
	});
});

describe("remainingSeconds", () => {
	it("rounds up so the last second reads 1", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(remainingSeconds(running, 59_100)).toBe(1);
	});

	it("is the full length right after starting", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(remainingSeconds(running, 0)).toBe(60);
	});

	it("never goes below zero", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(remainingSeconds(running, 90_000)).toBe(0);
	});

	it("reports what was left when paused", () => {
		const paused: TimerState = { phase: "paused", durationSeconds: 60, remainingMs: 14_500 };

		expect(remainingSeconds(paused, 99_999)).toBe(15);
	});

	it("is zero when idle or finished", () => {
		expect(remainingSeconds({ phase: "idle", durationSeconds: 60 }, 0)).toBe(0);
		expect(remainingSeconds({ phase: "finished", durationSeconds: 60 }, 0)).toBe(0);
	});
});

describe("remainingFraction", () => {
	it("is 1 when idle", () => {
		expect(remainingFraction({ phase: "idle", durationSeconds: 60 }, 0)).toBe(1);
	});

	it("is half when half the time has passed", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(remainingFraction(running, 30_000)).toBe(0.5);
	});

	it("uses the time left when paused", () => {
		const paused: TimerState = { phase: "paused", durationSeconds: 100, remainingMs: 25_000 };

		expect(remainingFraction(paused, 0)).toBe(0.25);
	});

	it("is 0 when finished", () => {
		expect(remainingFraction({ phase: "finished", durationSeconds: 60 }, 0)).toBe(0);
	});

	it("never exceeds 1 if the clock reads earlier than the start", () => {
		const running: TimerState = { phase: "running", durationSeconds: 60, endsAtMs: 60_000 };

		expect(remainingFraction(running, -10_000)).toBe(1);
	});
});
