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
	subscribe,
	/** Back to the start; for tests. */
	reset() {
		state = { status: "idle" };
		retryCount = 0;
		notify();
	}
};

export function useLyricsState(): LyricsState {
	return useSyncExternalStore(subscribe, lyricsStore.get);
}

export function useLyricsRetryCount(): number {
	return useSyncExternalStore(subscribe, lyricsStore.getRetryCount);
}
