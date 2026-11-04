import { describe, expect, it } from "vitest";
import { describeNoteAge } from "./noteAge";

// Wednesday 4 November 2026, 14:00 local time.
const now = new Date(2026, 10, 4, 14, 0, 0).getTime();
const minutesAgo = (minutes: number) => now - minutes * 60_000;
const hoursAgo = (hours: number) => now - hours * 3_600_000;

describe("describeNoteAge", () => {
	it("says Just now for a note written seconds ago", () => {
		expect(describeNoteAge(now - 10_000, now, "en-US")).toBe("Just now");
	});

	it("says Just now for a clock that is slightly behind", () => {
		expect(describeNoteAge(now + 5000, now, "en-US")).toBe("Just now");
	});

	it("counts minutes", () => {
		expect(describeNoteAge(minutesAgo(5), now, "en-US")).toBe("5 min ago");
	});

	it("says at least 1 min once past the just-now window", () => {
		expect(describeNoteAge(now - 50_000, now, "en-US")).toBe("1 min ago");
	});

	it("counts hours within a day", () => {
		expect(describeNoteAge(hoursAgo(3), now, "en-US")).toBe("3 h ago");
	});

	it("still counts hours just under a day, even across midnight", () => {
		expect(describeNoteAge(hoursAgo(15), now, "en-US")).toBe("15 h ago");
	});

	it("says Yesterday for the day before", () => {
		const yesterdayMorning = new Date(2026, 10, 3, 9, 0, 0).getTime();

		expect(describeNoteAge(yesterdayMorning, now, "en-US")).toBe("Yesterday");
	});

	it("gives a weekday for earlier in the week", () => {
		const monday = new Date(2026, 10, 2, 9, 0, 0).getTime();

		expect(describeNoteAge(monday, now, "en-US")).toBe("Mon");
	});

	it("gives a date from a week ago", () => {
		const lastWeek = new Date(2026, 9, 28, 9, 0, 0).getTime();

		expect(describeNoteAge(lastWeek, now, "en-US")).toBe("Oct 28");
	});

	it("adds the year for a note from another year", () => {
		const lastYear = new Date(2025, 5, 12, 9, 0, 0).getTime();

		expect(describeNoteAge(lastYear, now, "en-US")).toBe("Jun 12, 2025");
	});
});
