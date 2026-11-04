/** The longest timer: three hours. */
export const MAX_TIMER_SECONDS = 180 * 60;

/** A duration split the way the wheel picker shows it. */
export interface DurationParts {
	hours: number;
	minutes: number;
	seconds: number;
}

/** Keeps a duration between zero and the timer limit, in whole seconds. */
export function clampTimerSeconds(seconds: number): number {
	if (!Number.isFinite(seconds)) return 0;
	return Math.min(MAX_TIMER_SECONDS, Math.max(0, Math.round(seconds)));
}

export function secondsToParts(totalSeconds: number): DurationParts {
	const clamped = clampTimerSeconds(totalSeconds);
	return {
		hours: Math.floor(clamped / 3600),
		minutes: Math.floor((clamped % 3600) / 60),
		seconds: clamped % 60
	};
}

/** The duration the wheels show, held to the timer limit. */
export function partsToSeconds({ hours, minutes, seconds }: DurationParts): number {
	return clampTimerSeconds(hours * 3600 + minutes * 60 + seconds);
}

const twoDigits = (value: number) => value.toString().padStart(2, "0");

/**
 * Minutes and seconds only, with minutes growing past 59: "5:00", "75:00", "180:00".
 * This is the compact form the collapsed notch has room for.
 */
export function formatTimerTime(totalSeconds: number): string {
	const total = Math.abs(totalSeconds);
	return `${Math.floor(total / 60)}:${twoDigits(total % 60)}`;
}

/** The form the timer view shows: "24:59", and "1:05:00" once there are hours. */
export function formatClock(totalSeconds: number): string {
	const { hours, minutes, seconds } = secondsToParts(totalSeconds);
	return hours > 0
		? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
		: `${minutes}:${twoDigits(seconds)}`;
}

/** A spoken-style length for presets and recents: "5 min", "1 h", "1 h 30 min", "45 sec". */
export function formatDurationLabel(totalSeconds: number): string {
	const { hours, minutes, seconds } = secondsToParts(totalSeconds);
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours} h`);
	if (minutes > 0) parts.push(`${minutes} min`);
	if (seconds > 0 && hours === 0) parts.push(`${seconds} sec`);
	return parts.join(" ") || "0 sec";
}
