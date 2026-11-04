import { describe, expect, it } from "vitest";
import { parseRecentDurations, TIMER_PRESET_SECONDS, withRecentDuration } from "./timerPresets";

describe("withRecentDuration", () => {
	it("remembers a custom duration", () => {
		expect(withRecentDuration([], 420)).toEqual([420]);
	});

	it("puts the newest first", () => {
		expect(withRecentDuration([420], 90)).toEqual([90, 420]);
	});

	it("moves a repeated duration to the front instead of listing it twice", () => {
		expect(withRecentDuration([90, 420], 420)).toEqual([420, 90]);
	});

	it("keeps only the two newest", () => {
		expect(withRecentDuration([90, 420], 1234)).toEqual([1234, 90]);
	});

	it("does not remember a duration that already has a preset button", () => {
		expect(withRecentDuration([420], 25 * 60)).toEqual([420]);
	});

	it("does not remember zero, a negative or a fractional duration", () => {
		expect(withRecentDuration([420], 0)).toEqual([420]);
		expect(withRecentDuration([420], -60)).toEqual([420]);
		expect(withRecentDuration([420], 12.5)).toEqual([420]);
	});

	it("does not remember a duration over three hours", () => {
		expect(withRecentDuration([420], 3 * 3600 + 1)).toEqual([420]);
	});
});

describe("parseRecentDurations", () => {
	it("reads a saved list", () => {
		expect(parseRecentDurations("[90,420]")).toEqual([90, 420]);
	});

	it("is empty when nothing was saved", () => {
		expect(parseRecentDurations(null)).toEqual([]);
	});

	it("is empty for text that is not JSON", () => {
		expect(parseRecentDurations("[oops")).toEqual([]);
	});

	it("is empty for JSON that is not a list", () => {
		expect(parseRecentDurations('{"a":1}')).toEqual([]);
	});

	it("drops entries that are not usable durations, keeping the good ones", () => {
		expect(parseRecentDurations('[90,"soon",-5,420,0]')).toEqual([90, 420]);
	});

	it("drops a saved preset, which has its own button", () => {
		expect(parseRecentDurations("[300,90]")).toEqual([90]);
	});

	it("keeps only the two newest", () => {
		expect(parseRecentDurations("[90,420,777]")).toEqual([90, 420]);
	});
});

describe("TIMER_PRESET_SECONDS", () => {
	it("offers 5, 10, 15 and 25 minutes", () => {
		expect(TIMER_PRESET_SECONDS).toEqual([300, 600, 900, 1500]);
	});
});
