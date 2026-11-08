import { useCallback, useEffect, useRef, useState } from "react";
import { extrapolatePosition } from "./playbackClock";

/** How often the shown position is refreshed, in milliseconds. */
const TICK_INTERVAL_MS = 250;

export interface UsePlaybackClockOptions {
	/** The position the backend last reported, in milliseconds. */
	positionMs: number;
	/** When the backend reported it (milliseconds since the Unix epoch); 0 if unknown. */
	positionUpdatedAt: number;
	/** The track's length in milliseconds, or 0 when the player does not say. */
	durationMs: number;
	isPlaying: boolean;
}

export interface PlaybackClock {
	/** The position now, in milliseconds. */
	positionMs: number;
	/** The user has taken hold of the seek bar; the clock stops following the player. */
	beginSeek: () => void;
	/** The user moved the seek bar to `positionMs`; it shows there while they hold it. */
	previewSeek: (positionMs: number) => void;
	/**
	 * The user let go. The clock carries on from the position they chose, and the position is
	 * returned so the caller can tell the player.
	 */
	commitSeek: () => number;
}

/**
 * The live playhead of the track that is playing: the backend's last report, moved on with
 * the time since, refreshed four times a second. Shared by every music layout so they agree,
 * and by anything that follows the song (the lyrics).
 */
export function usePlaybackClock({
	positionMs,
	positionUpdatedAt,
	durationMs,
	isPlaying
}: UsePlaybackClockOptions): PlaybackClock {
	const reportedPositionRef = useRef(positionMs);
	const reportedAtRef = useRef(positionUpdatedAt || Date.now());
	const isSeekingRef = useRef(false);

	// A new report replaces the old one, unless the user is holding the seek bar.
	useEffect(() => {
		if (isSeekingRef.current) return;
		reportedPositionRef.current = positionMs;
		reportedAtRef.current = positionUpdatedAt || Date.now();
	}, [positionMs, positionUpdatedAt]);

	const positionNow = useCallback(
		() =>
			extrapolatePosition({
				positionMs: reportedPositionRef.current,
				receivedAtMs: reportedAtRef.current,
				nowMs: Date.now(),
				isPlaying,
				durationMs
			}),
		[isPlaying, durationMs]
	);

	const [shownPositionMs, setShownPositionMs] = useState(positionNow);

	// The latest shown position, readable by commitSeek without making it change every tick.
	const shownPositionRef = useRef(shownPositionMs);
	shownPositionRef.current = shownPositionMs;

	useEffect(() => {
		const tick = () => {
			if (!isSeekingRef.current) setShownPositionMs(positionNow());
		};
		tick();
		const interval = setInterval(tick, TICK_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [positionNow]);

	const beginSeek = useCallback(() => {
		isSeekingRef.current = true;
	}, []);

	const previewSeek = useCallback((previewMs: number) => {
		setShownPositionMs(previewMs);
	}, []);

	const commitSeek = useCallback(() => {
		isSeekingRef.current = false;
		reportedPositionRef.current = shownPositionRef.current;
		reportedAtRef.current = Date.now();
		return shownPositionRef.current;
	}, []);

	return { positionMs: shownPositionMs, beginSeek, previewSeek, commitSeek };
}
