/**
 * Where the playhead of the track that is playing is right now.
 *
 * Windows reports the position only now and then (the backend polls every 2 s and sends an
 * update when it has drifted by more than a second), so the notch works out the position
 * between reports from the last one and the time that has passed since. Everything here is
 * in milliseconds.
 */

export interface PlaybackPositionReport {
	/** The position the backend last reported. */
	positionMs: number;
	/** When the backend reported it, in milliseconds since the Unix epoch. */
	receivedAtMs: number;
	/** Now, in milliseconds since the Unix epoch. */
	nowMs: number;
	isPlaying: boolean;
	/** The track's length, or 0 when the player does not say. */
	durationMs: number;
}

/**
 * The position now. While playing it moves on from the last report; while paused it stays
 * where it was. It never passes the end of a track whose length is known.
 */
export function extrapolatePosition({
	positionMs,
	receivedAtMs,
	nowMs,
	isPlaying,
	durationMs
}: PlaybackPositionReport): number {
	const elapsedMs = isPlaying ? Math.max(0, nowMs - receivedAtMs) : 0;
	const position = positionMs + elapsedMs;
	return durationMs > 0 ? Math.min(position, durationMs) : position;
}

function minutesAndSeconds(totalMs: number): string {
	const totalSeconds = Math.floor(Math.max(0, totalMs) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** A position as the player shows it: "0:52", "12:05". Negative values show as "0:00". */
export function formatPlaybackTime(positionMs: number): string {
	return minutesAndSeconds(positionMs);
}

/** How much of the track is left, with a minus sign: "-1:21". Past the end shows "-0:00". */
export function formatTimeRemaining(positionMs: number, durationMs: number): string {
	return `-${minutesAndSeconds(durationMs - positionMs)}`;
}
