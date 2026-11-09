import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "../../hooks/useSettingsSync";

export const CARD_LYRICS_SETTING_KEY = "zara-card-lyrics";

const readStored = () => {
	try {
		return localStorage.getItem(CARD_LYRICS_SETTING_KEY) === "true";
	} catch {
		return false;
	}
};

export interface CardLyricsPreference {
	/** The lyrics are shown on the music card. */
	shown: boolean;
	toggle: () => void;
}

/**
 * Whether the music card shows lyrics over the cover, remembered between sessions. Off until
 * the user presses the card's lyrics button; pressing it is what allows the song's name to be
 * looked up (see `lyrics.rs`).
 */
export function useCardLyricsPreference(): CardLyricsPreference {
	const [shown, setShown] = useState(readStored);

	// The sync hook has already mirrored the changed value into localStorage when it calls us.
	useSettingsSync({ [CARD_LYRICS_SETTING_KEY]: () => setShown(readStored()) });

	const toggle = useCallback(() => {
		const next = !shown;
		setShown(next);
		try {
			localStorage.setItem(CARD_LYRICS_SETTING_KEY, String(next));
		} catch {
			// The saved file is the source of truth; the browser's copy is only for the first paint.
		}
		invoke("save_setting", { key: CARD_LYRICS_SETTING_KEY, value: String(next) }).catch(() => {});
	}, [shown]);

	return { shown, toggle };
}
