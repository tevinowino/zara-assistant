import { useLayoutEffect, useSyncExternalStore } from "react";
import { useAiSession, type AiSession, type UseAiSessionOptions } from "./useAiSession";

/**
 * Where the assistant conversation is shared with the parts of the notch that
 * need it.
 *
 * The conversation must outlive the panel (closing the notch must not lose a
 * chat), so it is owned by the notch rather than by the panel. But while an
 * answer streams in, the conversation changes about sixteen times a second,
 * and if `App` held it as ordinary state every one of those changes would
 * re-render the whole notch. Here it is held by `AiSessionHost`, a component
 * that renders nothing, and published to this store. A reader subscribes to
 * just the part it uses, and is re-rendered only when that part changes: the
 * panel follows everything; the Ask Zara bar follows one yes/no (is a question
 * being answered).
 */
export interface AiSessionStore {
	/** The conversation as of its latest change; null until the host has mounted. */
	current(): AiSession | null;
	subscribe(listener: () => void): () => void;
	/** Called by `AiSessionHost` on every change of the conversation. */
	publish(session: AiSession): void;
	/**
	 * The conversation for an event handler to act on. Throws if the host has not
	 * mounted, which would be a bug in how the notch is assembled.
	 */
	require(): AiSession;
}

export function createAiSessionStore(): AiSessionStore {
	let session: AiSession | null = null;
	const listeners = new Set<() => void>();
	return {
		current: () => session,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publish(next) {
			session = next;
			listeners.forEach((listener) => listener());
		},
		require() {
			if (!session) throw new Error("The assistant conversation has not started yet");
			return session;
		}
	};
}

/**
 * Runs the conversation and publishes every change to `store`. Renders
 * nothing, so its frequent updates re-render only this component and the
 * readers that subscribed. Mount it once for the life of the notch.
 */
export function AiSessionHost({
	store,
	...options
}: UseAiSessionOptions & { store: AiSessionStore }): null {
	const session = useAiSession(options);
	// Published before the browser paints, so a reader never shows a change a frame late.
	useLayoutEffect(() => store.publish(session));
	return null;
}

/**
 * The part of the conversation `select` picks out, re-rendering the caller only
 * when that part changes (compared with `Object.is`, so select a primitive or an
 * existing reference). `whenAbsent` is what the caller sees before the host has
 * mounted.
 */
export function useAiSessionSelector<Selected>(
	store: AiSessionStore,
	select: (session: AiSession) => Selected,
	whenAbsent: Selected
): Selected {
	return useSyncExternalStore(store.subscribe, () => {
		const session = store.current();
		return session ? select(session) : whenAbsent;
	});
}
