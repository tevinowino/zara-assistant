/** A clock reading split the way the notch draws it: large digits, and a small AM or PM. */
export interface ClockParts {
	/** "1:07" on a 12-hour clock, "13:07" or "09:05" on a 24-hour one. */
	time: string;
	/** "PM" on a 12-hour clock; null on a 24-hour one or where the locale has none. */
	dayPeriod: string | null;
}

/**
 * Splits `date` into the digits and the day period. A 12-hour clock drops the leading zero
 * ("1:07", not "01:07"), because the notch is read at a glance and the extra zero only
 * widens it; a 24-hour clock keeps two digits so its width never changes.
 */
export function clockParts(date: Date, hour12: boolean, locale?: string): ClockParts {
	const parts = new Intl.DateTimeFormat(locale, {
		hour: hour12 ? "numeric" : "2-digit",
		minute: "2-digit",
		hour12
	}).formatToParts(date);

	const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value.trim() ?? null;
	const time = parts
		.filter((part) => part.type !== "dayPeriod")
		.map((part) => part.value)
		.join("")
		.trim();
	return { time, dayPeriod };
}

export function sameClockParts(a: ClockParts, b: ClockParts): boolean {
	return a.time === b.time && a.dayPeriod === b.dayPeriod;
}
