import { clampTimerSeconds } from "./timerFormat";

/** One-tap start durations: a short break, a pause, a coffee, and a Pomodoro. */
export const TIMER_PRESET_SECONDS: readonly number[] = [5 * 60, 10 * 60, 15 * 60, 25 * 60];

/** How many custom durations the timer remembers beside the presets. */
export const MAX_RECENT_DURATIONS = 2;

function isUsableRecent(seconds: unknown): seconds is number {
	return (
		typeof seconds === "number" &&
		Number.isInteger(seconds) &&
		seconds > 0 &&
		seconds === clampTimerSeconds(seconds) &&
		!TIMER_PRESET_SECONDS.includes(seconds)
	);
}

/**
 * `recents` with `seconds` put first. A duration that is already a preset is not
 * remembered (it already has a button), a repeat moves to the front, and only the
 * newest few are kept.
 */
export function withRecentDuration(recents: readonly number[], seconds: number): number[] {
	if (!isUsableRecent(seconds)) return [...recents];
	return [seconds, ...recents.filter((recent) => recent !== seconds)].slice(
		0,
		MAX_RECENT_DURATIONS
	);
}

/** Reads the stored recents, dropping anything that is not a usable duration. */
export function parseRecentDurations(stored: string | null): number[] {
	if (!stored) return [];
	try {
		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isUsableRecent).slice(0, MAX_RECENT_DURATIONS);
	} catch {
		return [];
	}
}
