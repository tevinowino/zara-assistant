import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { lyricsStore, useLyricsRetryCount } from "./lyricsStore";
import { stateFromResult, trackKeyOf, type LyricsResult, type MediaSnapshot } from "./lyricsTypes";

/**
 * Fetches the lyrics of the track that is playing into `lyricsStore`, once per track, while the
 * Lyrics widget is on. Asking sends the track's artist, title and length to lrclib.net (see
 * `lyrics.rs`), so nothing is asked while `enabled` is false. A new track replaces the
 * previous one's lyrics at once, and an answer that arrives for a track that is no longer
 * playing is ignored.
 */
export function useTrackLyrics(enabled: boolean, { mediaInfo }: MediaSnapshot): void {
	const trackKey = trackKeyOf(mediaInfo);
	const { title, artist, duration_ms: durationMs } = mediaInfo;
	const retryCount = useLyricsRetryCount();

	useEffect(() => {
		if (!enabled || trackKey === null) {
			lyricsStore.set({ status: "idle" });
			return;
		}
		let cancelled = false;
		lyricsStore.set({ status: "loading", trackKey });
		invoke<LyricsResult>("lyrics_for_track", { title, artist, durationMs: durationMs ?? null })
			.then((result) => {
				if (!cancelled) lyricsStore.set(stateFromResult(trackKey, result));
			})
			.catch(() => {
				if (!cancelled) lyricsStore.set({ status: "error", trackKey });
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, trackKey, title, artist, durationMs, retryCount]);
}
