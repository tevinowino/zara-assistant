import type { LyricLine } from "./lyricsTypes";

/**
 * The index of the line being sung at `positionMs`: the last line that has started. -1 before
 * the first line starts. `lines` must be in time order, as the backend sends them.
 */
export function activeLineIndex(lines: readonly LyricLine[], positionMs: number): number {
	let low = 0;
	let high = lines.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (lines[middle].timeMs <= positionMs) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return found;
}

/** The step of the sync adjustment, in milliseconds. */
export const LYRICS_OFFSET_STEP_MS = 250;
/** The most the lyrics can be moved either way, in milliseconds. */
export const LYRICS_OFFSET_LIMIT_MS = 5000;
/**
 * The position is read four times a second, so a line is shown up to a quarter of a second
 * late; looking this far ahead (in milliseconds) evens that out.
 */
export const LYRICS_LOOKAHEAD_MS = 125;

/** The stored offset as a number: whole steps within the limit; anything unreadable is 0. */
export function parseLyricsOffset(stored: string | null | undefined): number {
	const value = Number(stored);
	if (!stored || !Number.isFinite(value)) return 0;
	return Math.max(-LYRICS_OFFSET_LIMIT_MS, Math.min(LYRICS_OFFSET_LIMIT_MS, Math.round(value)));
}

/**
 * The line to highlight at `positionMs`, moved by the user's offset (positive shows lyrics
 * sooner, for a song whose lyrics seem late) and by the lookahead.
 */
export function lineToHighlight(
	lines: readonly LyricLine[],
	positionMs: number,
	offsetMs: number
): number {
	return activeLineIndex(lines, positionMs + offsetMs + LYRICS_LOOKAHEAD_MS);
}
