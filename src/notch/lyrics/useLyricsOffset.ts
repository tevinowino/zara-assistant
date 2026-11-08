import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import { LYRICS_OFFSET_LIMIT_MS, LYRICS_OFFSET_STEP_MS, parseLyricsOffset } from "./activeLine";

export const LYRICS_OFFSET_SETTING_KEY = "zara-lyrics-offset-ms";

const readStoredOffset = () => {
	try {
		return parseLyricsOffset(localStorage.getItem(LYRICS_OFFSET_SETTING_KEY));
	} catch {
		return 0;
	}
};

export interface LyricsOffsetController {
	/** How far the lyrics are moved, in milliseconds; positive shows them sooner. */
	offsetMs: number;
	/** Moves the lyrics one step sooner or later and saves it. */
	nudge: (direction: "sooner" | "later") => void;
	reset: () => void;
}

/**
 * The user's correction for lyrics that run early or late, saved so it applies to every song:
 * players report their position a little differently, and the same player is usually off by
 * the same amount.
 */
export function useLyricsOffset(): LyricsOffsetController {
	const [offsetMs, setOffsetMs] = useState(readStoredOffset);

	// The sync hook has already mirrored the changed value into localStorage when it calls us.
	useSettingsSync({ [LYRICS_OFFSET_SETTING_KEY]: () => setOffsetMs(readStoredOffset()) });

	const save = useCallback((next: number) => {
		const clamped = Math.max(-LYRICS_OFFSET_LIMIT_MS, Math.min(LYRICS_OFFSET_LIMIT_MS, next));
		setOffsetMs(clamped);
		try {
			localStorage.setItem(LYRICS_OFFSET_SETTING_KEY, String(clamped));
		} catch {
			// The saved file is the source of truth; the browser's copy is only for the first paint.
		}
		invoke("save_setting", { key: LYRICS_OFFSET_SETTING_KEY, value: String(clamped) }).catch(
			() => {}
		);
	}, []);

	const nudge = useCallback(
		(direction: "sooner" | "later") =>
			save(offsetMs + (direction === "sooner" ? LYRICS_OFFSET_STEP_MS : -LYRICS_OFFSET_STEP_MS)),
		[offsetMs, save]
	);

	return { offsetMs, nudge, reset: () => save(0) };
}
