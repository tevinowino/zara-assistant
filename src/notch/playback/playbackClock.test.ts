import { describe, expect, it } from "vitest";
import { extrapolatePosition, formatPlaybackTime, formatTimeRemaining } from "./playbackClock";

describe("extrapolatePosition", () => {
	it("moves on from the last report by the time since while playing", () => {
		const position = extrapolatePosition({
			positionMs: 52_000,
			receivedAtMs: 1_000_000,
			nowMs: 1_001_500,
			isPlaying: true,
			durationMs: 200_000
		});

		expect(position).toBe(53_500);
	});

	it("stays where the last report left it while paused", () => {
		const position = extrapolatePosition({
			positionMs: 52_000,
			receivedAtMs: 1_000_000,
			nowMs: 1_060_000,
			isPlaying: false,
			durationMs: 200_000
		});

		expect(position).toBe(52_000);
	});

	it("never passes the end of a track whose length is known", () => {
		const position = extrapolatePosition({
			positionMs: 199_000,
			receivedAtMs: 1_000_000,
			nowMs: 1_010_000,
			isPlaying: true,
			durationMs: 200_000
		});

		expect(position).toBe(200_000);
	});

	it("keeps counting when the player does not say how long the track is", () => {
		const position = extrapolatePosition({
			positionMs: 10_000,
			receivedAtMs: 1_000_000,
			nowMs: 1_005_000,
			isPlaying: true,
			durationMs: 0
		});

		expect(position).toBe(15_000);
	});

	it("does not move backwards if the report is stamped in the future", () => {
		const position = extrapolatePosition({
			positionMs: 10_000,
			receivedAtMs: 1_005_000,
			nowMs: 1_000_000,
			isPlaying: true,
			durationMs: 200_000
		});

		expect(position).toBe(10_000);
	});
});

describe("formatPlaybackTime", () => {
	it("shows minutes and two-digit seconds", () => {
		expect(formatPlaybackTime(52_000)).toBe("0:52");
	});

	it("rounds down to the whole second", () => {
		expect(formatPlaybackTime(59_999)).toBe("0:59");
	});

	it("carries past an hour into minutes", () => {
		expect(formatPlaybackTime(3_725_000)).toBe("62:05");
	});

	it("shows 0:00 for zero and for a negative position", () => {
		expect(formatPlaybackTime(0)).toBe("0:00");
		expect(formatPlaybackTime(-5_000)).toBe("0:00");
	});
});

describe("formatTimeRemaining", () => {
	it("shows what is left with a minus sign", () => {
		expect(formatTimeRemaining(52_000, 133_000)).toBe("-1:21");
	});

	it("shows -0:00 at and past the end", () => {
		expect(formatTimeRemaining(133_000, 133_000)).toBe("-0:00");
		expect(formatTimeRemaining(140_000, 133_000)).toBe("-0:00");
	});
});
