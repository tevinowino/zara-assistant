import { describe, expect, it } from "vitest";
import {
	clampTimerSeconds,
	formatClock,
	formatDurationLabel,
	formatTimerTime,
	MAX_TIMER_SECONDS,
	partsToSeconds,
	secondsToParts
} from "./timerFormat";

describe("clampTimerSeconds", () => {
	it("keeps a duration within the limit as it is", () => {
		expect(clampTimerSeconds(1500)).toBe(1500);
	});

	it("holds a longer duration to three hours", () => {
		expect(clampTimerSeconds(MAX_TIMER_SECONDS + 1)).toBe(10800);
	});

	it("holds a negative duration to zero", () => {
		expect(clampTimerSeconds(-5)).toBe(0);
	});

	it("rounds to whole seconds", () => {
		expect(clampTimerSeconds(59.6)).toBe(60);
	});

	it("treats a number that is not finite as zero", () => {
		expect(clampTimerSeconds(Number.NaN)).toBe(0);
		expect(clampTimerSeconds(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("secondsToParts", () => {
	it("splits 1 hour 5 minutes 9 seconds", () => {
		expect(secondsToParts(3909)).toEqual({ hours: 1, minutes: 5, seconds: 9 });
	});

	it("splits a plain 25 minutes", () => {
		expect(secondsToParts(1500)).toEqual({ hours: 0, minutes: 25, seconds: 0 });
	});

	it("splits the three-hour limit", () => {
		expect(secondsToParts(10800)).toEqual({ hours: 3, minutes: 0, seconds: 0 });
	});
});

describe("partsToSeconds", () => {
	it("joins the parts", () => {
		expect(partsToSeconds({ hours: 1, minutes: 30, seconds: 15 })).toBe(5415);
	});

	it("holds the total to three hours when the wheels go past it", () => {
		expect(partsToSeconds({ hours: 3, minutes: 30, seconds: 0 })).toBe(10800);
	});

	it("round-trips through secondsToParts", () => {
		expect(partsToSeconds(secondsToParts(4321))).toBe(4321);
	});
});

describe("formatTimerTime", () => {
	it("shows minutes and zero-padded seconds", () => {
		expect(formatTimerTime(305)).toBe("5:05");
	});

	it("lets the minutes pass 59 rather than showing hours", () => {
		expect(formatTimerTime(4500)).toBe("75:00");
	});

	it("shows zero", () => {
		expect(formatTimerTime(0)).toBe("0:00");
	});
});

describe("formatClock", () => {
	it("shows minutes and seconds under an hour", () => {
		expect(formatClock(1499)).toBe("24:59");
	});

	it("shows hours, padded minutes and seconds from an hour", () => {
		expect(formatClock(3900)).toBe("1:05:00");
	});

	it("shows the three-hour limit", () => {
		expect(formatClock(10800)).toBe("3:00:00");
	});
});

describe("formatDurationLabel", () => {
	it("names whole minutes", () => {
		expect(formatDurationLabel(300)).toBe("5 min");
	});

	it("names whole hours", () => {
		expect(formatDurationLabel(3600)).toBe("1 h");
	});

	it("names hours with minutes", () => {
		expect(formatDurationLabel(5400)).toBe("1 h 30 min");
	});

	it("names minutes with seconds", () => {
		expect(formatDurationLabel(90)).toBe("1 min 30 sec");
	});

	it("names bare seconds", () => {
		expect(formatDurationLabel(45)).toBe("45 sec");
	});

	it("leaves seconds out once there are hours", () => {
		expect(formatDurationLabel(3661)).toBe("1 h 1 min");
	});
});
