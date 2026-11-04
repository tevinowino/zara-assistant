import { describe, expect, it } from "vitest";
import { clockParts, sameClockParts } from "./clockParts";

describe("clockParts on a 12-hour clock", () => {
	it("drops the leading zero in the afternoon", () => {
		expect(clockParts(new Date(2026, 0, 2, 13, 7), true, "en-US")).toEqual({
			time: "1:07",
			dayPeriod: "PM"
		});
	});

	it("drops the leading zero in the morning", () => {
		expect(clockParts(new Date(2026, 0, 2, 9, 5), true, "en-US")).toEqual({
			time: "9:05",
			dayPeriod: "AM"
		});
	});

	it("keeps two-digit hours when there are two", () => {
		expect(clockParts(new Date(2026, 0, 2, 22, 45), true, "en-US")).toEqual({
			time: "10:45",
			dayPeriod: "PM"
		});
	});

	it("reads midnight as 12 AM", () => {
		expect(clockParts(new Date(2026, 0, 2, 0, 3), true, "en-US")).toEqual({
			time: "12:03",
			dayPeriod: "AM"
		});
	});

	it("reads noon as 12 PM", () => {
		expect(clockParts(new Date(2026, 0, 2, 12, 0), true, "en-US")).toEqual({
			time: "12:00",
			dayPeriod: "PM"
		});
	});

	it("has no stray spaces in either part", () => {
		const { time, dayPeriod } = clockParts(new Date(2026, 0, 2, 13, 7), true, "en-US");

		expect(time).toBe(time.trim());
		expect(dayPeriod).toBe(dayPeriod?.trim());
	});
});

describe("clockParts on a 24-hour clock", () => {
	it("shows the afternoon as 13:07 with no day period", () => {
		expect(clockParts(new Date(2026, 0, 2, 13, 7), false, "en-US")).toEqual({
			time: "13:07",
			dayPeriod: null
		});
	});

	it("keeps the leading zero so the width never changes", () => {
		expect(clockParts(new Date(2026, 0, 2, 9, 5), false, "en-US")).toEqual({
			time: "09:05",
			dayPeriod: null
		});
	});

	it("reads midnight as 00:03", () => {
		expect(clockParts(new Date(2026, 0, 2, 0, 3), false, "en-US").time).toBe("00:03");
	});
});

describe("sameClockParts", () => {
	it("is true for equal readings", () => {
		expect(
			sameClockParts({ time: "1:07", dayPeriod: "PM" }, { time: "1:07", dayPeriod: "PM" })
		).toBe(true);
	});

	it("is false when the minute changes", () => {
		expect(
			sameClockParts({ time: "1:07", dayPeriod: "PM" }, { time: "1:08", dayPeriod: "PM" })
		).toBe(false);
	});

	it("is false when only the day period changes", () => {
		expect(
			sameClockParts({ time: "12:00", dayPeriod: "AM" }, { time: "12:00", dayPeriod: "PM" })
		).toBe(false);
	});
});
