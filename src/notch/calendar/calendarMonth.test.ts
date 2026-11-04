import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	buildMonthGrid,
	daysBetween,
	describeDate,
	describeRelativeDays,
	isoWeekNumber,
	isSameDay,
	localeWeekStart,
	monthDirection,
	monthOf,
	weekdayInitials
} from "./calendarMonth";

describe("addMonths", () => {
	it("moves forward within a year", () => {
		expect(addMonths({ year: 2026, month: 10 }, 1)).toEqual({ year: 2026, month: 11 });
	});

	it("rolls into the next year", () => {
		expect(addMonths({ year: 2026, month: 10 }, 3)).toEqual({ year: 2027, month: 1 });
	});

	it("moves backward across a year boundary", () => {
		expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
	});

	it("moves back by more than a year", () => {
		expect(addMonths({ year: 2026, month: 0 }, -11)).toEqual({ year: 2025, month: 1 });
	});

	it("stays put when asked to move zero months", () => {
		expect(addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
	});
});

describe("daysBetween", () => {
	it("counts whole days forward", () => {
		expect(daysBetween(new Date(2026, 10, 3), new Date(2026, 10, 14))).toBe(11);
	});

	it("counts negative days backward", () => {
		expect(daysBetween(new Date(2026, 10, 14), new Date(2026, 10, 11))).toBe(-3);
	});

	it("ignores the time of day", () => {
		expect(daysBetween(new Date(2026, 10, 3, 23, 59), new Date(2026, 10, 4, 0, 1))).toBe(1);
	});

	it("counts a leap day", () => {
		expect(daysBetween(new Date(2028, 1, 28), new Date(2028, 2, 1))).toBe(2);
	});
});

describe("isoWeekNumber", () => {
	it("numbers 14 November 2026 as week 46", () => {
		expect(isoWeekNumber(new Date(2026, 10, 14))).toBe(46);
	});

	it("puts 31 December 2024 in week 1 of 2025", () => {
		expect(isoWeekNumber(new Date(2024, 11, 31))).toBe(1);
	});

	it("puts 1 January 2021 in week 53 of 2020", () => {
		expect(isoWeekNumber(new Date(2021, 0, 1))).toBe(53);
	});

	it("starts a new week on Monday", () => {
		expect(isoWeekNumber(new Date(2026, 10, 15))).toBe(46); // Sunday
		expect(isoWeekNumber(new Date(2026, 10, 16))).toBe(47); // Monday
	});
});

describe("buildMonthGrid", () => {
	const november2026 = { year: 2026, month: 10 };
	const today = new Date(2026, 10, 14);

	it("always has six weeks of seven days", () => {
		const grid = buildMonthGrid(november2026, today, 0);

		expect(grid.weeks).toHaveLength(6);
		for (const week of grid.weeks) expect(week.days).toHaveLength(7);
	});

	it("keeps six weeks for a month that needs only four", () => {
		// February 2026 starts on a Sunday and has 28 days: exactly four weeks.
		const grid = buildMonthGrid({ year: 2026, month: 1 }, today, 0);

		expect(grid.weeks).toHaveLength(6);
	});

	it("starts the first row on the first of the month when it falls on the week start", () => {
		const grid = buildMonthGrid(november2026, today, 0); // 1 Nov 2026 is a Sunday

		expect(isSameDay(grid.weeks[0].days[0].date, new Date(2026, 10, 1))).toBe(true);
	});

	it("fills the first row with the previous month's days when the month starts midweek", () => {
		const grid = buildMonthGrid(november2026, today, 1); // Monday start: 1 Nov is the 7th cell

		expect(isSameDay(grid.weeks[0].days[0].date, new Date(2026, 9, 26))).toBe(true);
		expect(grid.weeks[0].days[0].inVisibleMonth).toBe(false);
		expect(grid.weeks[0].days[6].inVisibleMonth).toBe(true);
	});

	it("marks only the days of the shown month as in the month", () => {
		const grid = buildMonthGrid(november2026, today, 0);

		const inMonthDays = grid.weeks.flatMap((week) => week.days).filter((d) => d.inVisibleMonth);

		expect(inMonthDays).toHaveLength(30);
		expect(inMonthDays.every((d) => d.date.getMonth() === 10)).toBe(true);
	});

	it("marks today, once", () => {
		const grid = buildMonthGrid(november2026, today, 0);

		const todays = grid.weeks.flatMap((week) => week.days).filter((d) => d.isToday);

		expect(todays).toHaveLength(1);
		expect(isSameDay(todays[0].date, today)).toBe(true);
	});

	it("marks no day as today when browsing another month", () => {
		const grid = buildMonthGrid({ year: 2027, month: 4 }, today, 0);

		expect(grid.weeks.flatMap((week) => week.days).some((d) => d.isToday)).toBe(false);
	});

	it("gives each row the ISO week number of its Thursday for a Sunday week start", () => {
		const grid = buildMonthGrid(november2026, today, 0);

		expect(grid.weeks.map((week) => week.weekNumber)).toEqual([45, 46, 47, 48, 49, 50]);
	});

	it("gives each row the ISO week number of its Thursday for a Monday week start", () => {
		const grid = buildMonthGrid(november2026, today, 1);

		expect(grid.weeks.map((week) => week.weekNumber)).toEqual([44, 45, 46, 47, 48, 49]);
	});

	it("runs every day on from the one before it, across month ends", () => {
		const grid = buildMonthGrid({ year: 2026, month: 11 }, today, 0);

		const dates = grid.weeks.flatMap((week) => week.days).map((d) => d.date);

		for (let i = 1; i < dates.length; i++) {
			expect(isSameDay(dates[i], addDays(dates[i - 1], 1))).toBe(true);
		}
	});
});

describe("monthOf", () => {
	it("names the month a date is in", () => {
		expect(monthOf(new Date(2026, 10, 14))).toEqual({ year: 2026, month: 10 });
	});
});

describe("describeRelativeDays", () => {
	it("names today, tomorrow and yesterday", () => {
		expect(describeRelativeDays(0, "en-US")).toBe("Today");
		expect(describeRelativeDays(1, "en-US")).toBe("Tomorrow");
		expect(describeRelativeDays(-1, "en-US")).toBe("Yesterday");
	});

	it("counts days within two weeks", () => {
		expect(describeRelativeDays(11, "en-US")).toBe("In 11 days");
		expect(describeRelativeDays(-3, "en-US")).toBe("3 days ago");
	});

	it("counts weeks from two weeks out", () => {
		expect(describeRelativeDays(21, "en-US")).toBe("In 3 weeks");
		expect(describeRelativeDays(-28, "en-US")).toBe("4 weeks ago");
	});

	it("counts months from ten weeks out", () => {
		expect(describeRelativeDays(100, "en-US")).toBe("In 3 months");
		expect(describeRelativeDays(-200, "en-US")).toBe("7 months ago");
	});
});

describe("describeDate", () => {
	it("describes 14 November 2026 seen from 3 November", () => {
		const details = describeDate(new Date(2026, 10, 14), new Date(2026, 10, 3), "en-US");

		expect(details).toEqual({
			weekday: "Saturday",
			fullDate: "November 14, 2026",
			dayOfMonth: 14,
			isoWeekNumber: 46,
			dayOfYear: 318,
			daysInYear: 365,
			relativeToToday: "In 11 days"
		});
	});

	it("counts the leap day in a leap year", () => {
		const details = describeDate(new Date(2028, 2, 1), new Date(2028, 2, 1), "en-US");

		expect(details.dayOfYear).toBe(61);
		expect(details.daysInYear).toBe(366);
		expect(details.relativeToToday).toBe("Today");
	});

	it("describes the last day of the year", () => {
		const details = describeDate(new Date(2026, 11, 31), new Date(2026, 11, 31), "en-US");

		expect(details.dayOfYear).toBe(365);
	});
});

describe("weekdayInitials", () => {
	it("lists Sunday first for a Sunday week start", () => {
		expect(weekdayInitials(0, "en-US")).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
	});

	it("lists Monday first for a Monday week start", () => {
		expect(weekdayInitials(1, "en-US")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
	});
});

describe("localeWeekStart", () => {
	it("starts the week on Sunday in the United States", () => {
		expect(localeWeekStart("en-US")).toBe(0);
	});

	it("starts the week on Monday in Germany", () => {
		expect(localeWeekStart("de-DE")).toBe(1);
	});

	it("falls back to Sunday for a locale that does not exist", () => {
		expect(localeWeekStart("not a locale")).toBe(0);
	});
});

describe("monthDirection", () => {
	it("is 1 going to a later month", () => {
		expect(monthDirection({ year: 2026, month: 10 }, { year: 2026, month: 11 })).toBe(1);
	});

	it("is 1 going to a later year even when the month number is smaller", () => {
		expect(monthDirection({ year: 2026, month: 10 }, { year: 2027, month: 0 })).toBe(1);
	});

	it("is -1 going to an earlier month", () => {
		expect(monthDirection({ year: 2026, month: 0 }, { year: 2025, month: 11 })).toBe(-1);
	});

	it("is 0 for the same month", () => {
		expect(monthDirection({ year: 2026, month: 4 }, { year: 2026, month: 4 })).toBe(0);
	});
});
