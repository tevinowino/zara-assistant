/**
 * Calendar arithmetic for the notch's month view: which days fill a month's grid, and
 * what to say about any one date. Pure functions of their arguments; nothing here reads
 * the clock or the locale unless a caller passes them in.
 */

/** A month on the calendar. `month` is 0 (January) to 11 (December), as in `Date`. */
export interface CalendarMonth {
	year: number;
	month: number;
}

export interface CalendarDay {
	date: Date;
	/** False for the days of the neighbouring months that fill out the first and last rows. */
	inVisibleMonth: boolean;
	isToday: boolean;
}

export interface CalendarWeek {
	/** ISO 8601 week number (the week that holds the row's Thursday). */
	weekNumber: number;
	days: CalendarDay[];
}

/**
 * A month laid out as a grid. It always has six weeks, so the panel keeps one height
 * while the user moves between months.
 */
export interface MonthGrid {
	month: CalendarMonth;
	weeks: CalendarWeek[];
}

export const WEEKS_IN_GRID = 6;
const DAYS_IN_WEEK = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function monthOf(date: Date): CalendarMonth {
	return { year: date.getFullYear(), month: date.getMonth() };
}

/** The month `count` months after `from`; negative counts go back. */
export function addMonths(from: CalendarMonth, count: number): CalendarMonth {
	const zeroBased = from.year * 12 + from.month + count;
	return { year: Math.floor(zeroBased / 12), month: ((zeroBased % 12) + 12) % 12 };
}

/** 1 if `to` is a later month than `from`, -1 if earlier, 0 if the same month. */
export function monthDirection(from: CalendarMonth, to: CalendarMonth): -1 | 0 | 1 {
	const difference = to.year * 12 + to.month - (from.year * 12 + from.month);
	return difference > 0 ? 1 : difference < 0 ? -1 : 0;
}

export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function isSameMonth(a: CalendarMonth, b: CalendarMonth): boolean {
	return a.year === b.year && a.month === b.month;
}

/** The same calendar day `count` days away. Calendar days, so daylight saving cannot skew it. */
export function addDays(from: Date, count: number): Date {
	return new Date(from.getFullYear(), from.getMonth(), from.getDate() + count);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
	const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
	const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
	return Math.round((toUtc - fromUtc) / MILLISECONDS_PER_DAY);
}

/**
 * The ISO 8601 week number of a date: weeks start on Monday, and week 1 is the week
 * that holds the year's first Thursday.
 */
export function isoWeekNumber(date: Date): number {
	const thursdayOfThatWeek = addDays(date, 3 - ((date.getDay() + 6) % 7));
	const firstOfYear = new Date(thursdayOfThatWeek.getFullYear(), 0, 1);
	return Math.floor(daysBetween(firstOfYear, thursdayOfThatWeek) / DAYS_IN_WEEK) + 1;
}

/**
 * Lays out `month` as six weeks starting on `weekStart` (0 is Sunday, 1 is Monday, ...
 * 6 is Saturday). `today` marks which cell is today.
 */
export function buildMonthGrid(month: CalendarMonth, today: Date, weekStart: number): MonthGrid {
	const firstOfMonth = new Date(month.year, month.month, 1);
	const leadingDays = (firstOfMonth.getDay() - weekStart + DAYS_IN_WEEK) % DAYS_IN_WEEK;
	const gridStart = addDays(firstOfMonth, -leadingDays);
	// The week's Thursday decides its ISO week number.
	const thursdayColumn = (4 - weekStart + DAYS_IN_WEEK) % DAYS_IN_WEEK;

	const weeks: CalendarWeek[] = [];
	for (let weekIndex = 0; weekIndex < WEEKS_IN_GRID; weekIndex++) {
		const days: CalendarDay[] = [];
		for (let column = 0; column < DAYS_IN_WEEK; column++) {
			const date = addDays(gridStart, weekIndex * DAYS_IN_WEEK + column);
			days.push({
				date,
				inVisibleMonth: isSameMonth(monthOf(date), month),
				isToday: isSameDay(date, today)
			});
		}
		weeks.push({ weekNumber: isoWeekNumber(days[thursdayColumn].date), days });
	}
	return { month, weeks };
}

/**
 * The first day of the week for a locale: 0 for Sunday through 6 for Saturday. Falls back
 * to Sunday where the runtime cannot say.
 */
export function localeWeekStart(locale?: string): number {
	try {
		const info = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
			getWeekInfo?: () => { firstDay: number };
			weekInfo?: { firstDay: number };
		};
		const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
		// Intl numbers the days 1 (Monday) to 7 (Sunday).
		return typeof firstDay === "number" ? firstDay % 7 : 0;
	} catch {
		return 0;
	}
}

/** The seven weekday initials in grid order, such as S M T W T F S. */
export function weekdayInitials(weekStart: number, locale?: string): string[] {
	const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
	// 1 Nov 2026 is a Sunday, so offsetting from it walks the weekdays in order.
	return Array.from({ length: DAYS_IN_WEEK }, (_, column) =>
		formatter.format(new Date(2026, 10, 1 + ((weekStart + column) % DAYS_IN_WEEK)))
	);
}

/** What the day-details card says about a date. */
export interface DateDetails {
	/** "Saturday". */
	weekday: string;
	/** "November 14, 2026". */
	fullDate: string;
	dayOfMonth: number;
	isoWeekNumber: number;
	dayOfYear: number;
	daysInYear: number;
	/** "Today", "Tomorrow", "In 11 days", "3 weeks ago", ... */
	relativeToToday: string;
}

function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "Today", "Yesterday", "Tomorrow", then days up to two weeks out, weeks up to about
 * ten weeks, and months beyond.
 */
export function describeRelativeDays(dayDifference: number, locale?: string): string {
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const distance = Math.abs(dayDifference);
	let text: string;
	if (distance < 14) {
		text = formatter.format(dayDifference, "day");
	} else if (distance < 70) {
		text = formatter.format(Math.round(dayDifference / 7), "week");
	} else {
		text = formatter.format(Math.round(dayDifference / 30.44), "month");
	}
	return capitalizeFirst(text);
}

export function describeDate(date: Date, today: Date, locale?: string): DateDetails {
	const startOfYear = new Date(date.getFullYear(), 0, 1);
	const startOfNextYear = new Date(date.getFullYear() + 1, 0, 1);
	return {
		weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date),
		fullDate: new Intl.DateTimeFormat(locale, {
			month: "long",
			day: "numeric",
			year: "numeric"
		}).format(date),
		dayOfMonth: date.getDate(),
		isoWeekNumber: isoWeekNumber(date),
		dayOfYear: daysBetween(startOfYear, date) + 1,
		daysInYear: daysBetween(startOfYear, startOfNextYear),
		relativeToToday: describeRelativeDays(daysBetween(today, date), locale)
	};
}
