const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** A note this fresh is "Just now". */
const JUST_NOW_UNDER_MS = 45_000;

function startOfDay(timestampMs: number): number {
	const date = new Date(timestampMs);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * How long ago a note was written, as a short label for the notes list: "Just now",
 * "5 min ago", "3 h ago", "Yesterday", a weekday for the rest of the week, then a date.
 */
export function describeNoteAge(timestampMs: number, nowMs: number, locale?: string): string {
	const age = nowMs - timestampMs;
	if (age < JUST_NOW_UNDER_MS) return "Just now";
	if (age < MILLISECONDS_PER_HOUR) {
		return `${Math.max(1, Math.round(age / MILLISECONDS_PER_MINUTE))} min ago`;
	}
	if (age < MILLISECONDS_PER_DAY) return `${Math.floor(age / MILLISECONDS_PER_HOUR)} h ago`;

	const daysAgo = Math.round((startOfDay(nowMs) - startOfDay(timestampMs)) / MILLISECONDS_PER_DAY);
	if (daysAgo <= 1) return "Yesterday";
	if (daysAgo < 7) {
		return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(timestampMs);
	}
	const sameYear = new Date(timestampMs).getFullYear() === new Date(nowMs).getFullYear();
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" })
	}).format(timestampMs);
}
