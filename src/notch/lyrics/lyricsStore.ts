import { useSyncExternalStore } from "react";
import type { LyricsState } from "./lyricsTypes";

/**
 * The lyrics of the track that is playing, shared between whatever fetches them (a
 * background job that runs while the Lyrics widget is on) and whatever shows them. A store of
 * its own, rather than state in the notch, so the notch does not re-render every time a line
 * arrives.
 */
let state: LyricsState = { status: "idle" };
let retryCount = 0;
let cardWantsLyrics = false;
const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export const lyricsStore = {
	get: (): LyricsState => state,
	set(next: LyricsState) {
		state = next;
		notify();
	},
	/** Asks for the current track's lyrics to be fetched again (after an error). */
	retry() {
		retryCount += 1;
		notify();
	},
	getRetryCount: (): number => retryCount,
	/**
	 * The music card is open with its lyrics on, so the lyrics of the playing song should be
	 * fetched even though the Lyrics widget is off. Set by the card while it is on screen.
	 */
	setCardWantsLyrics(wants: boolean) {
		if (cardWantsLyrics === wants) return;
		cardWantsLyrics = wants;
		notify();
	},
	getCardWantsLyrics: (): boolean => cardWantsLyrics,
	subscribe,
	/** Back to the start; for tests. */
	reset() {
		state = { status: "idle" };
		retryCount = 0;
		cardWantsLyrics = false;
		notify();
	}
};

export function useLyricsState(): LyricsState {
	return useSyncExternalStore(subscribe, lyricsStore.get);
}

export function useCardWantsLyrics(): boolean {
	return useSyncExternalStore(subscribe, lyricsStore.getCardWantsLyrics);
}

export function useLyricsRetryCount(): number {
	return useSyncExternalStore(subscribe, lyricsStore.getRetryCount);
}
