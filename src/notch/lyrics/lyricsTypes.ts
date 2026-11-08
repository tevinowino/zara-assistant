import type { MediaInfo } from "../types";

/** One line of a song and when it is sung. */
export interface LyricLine {
	/** Milliseconds from the start of the track. */
	timeMs: number;
	/** What is sung; empty for an instrumental break. */
	text: string;
}

/** What the backend's `lyrics_for_track` answers. */
export type LyricsResult =
	| { status: "synced"; lines: LyricLine[] }
	| { status: "plain"; text: string }
	| { status: "instrumental" }
	| { status: "none" }
	| { status: "error" };

/** What the notch knows about the lyrics of the track that is playing. */
export type LyricsState =
	/** Nothing is playing, or the Lyrics widget is off. */
	| { status: "idle" }
	| { status: "loading"; trackKey: string }
	| { status: "synced"; trackKey: string; lines: LyricLine[] }
	| { status: "plain"; trackKey: string; text: string }
	| { status: "instrumental" | "none" | "error"; trackKey: string };

/** What is playing, as the notch hands it to a widget. */
export interface MediaSnapshot {
	mediaInfo: MediaInfo;
	isPlaying: boolean;
}

/**
 * Identifies a track: two tracks with the same artist, title and length have the same lyrics.
 * Null while nothing is playing.
 */
export function trackKeyOf(mediaInfo: MediaInfo): string | null {
	if (!mediaInfo.has_media || mediaInfo.title.trim() === "") return null;
	const seconds = Math.round((mediaInfo.duration_ms ?? 0) / 1000);
	return [mediaInfo.artist, mediaInfo.title, seconds].join("\u001f");
}

/** The state for a track once the backend has answered. */
export function stateFromResult(trackKey: string, result: LyricsResult): LyricsState {
	switch (result.status) {
		case "synced":
			return { status: "synced", trackKey, lines: result.lines };
		case "plain":
			return { status: "plain", trackKey, text: result.text };
		default:
			return { status: result.status, trackKey };
	}
}
