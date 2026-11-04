// Test replacement for @tauri-apps/api/event (see vitest.config.ts).
//
// listen() subscribes in memory. A test delivers an event with emitTauriEvent,
// which is how the backend's app.emit(...) is simulated.

type Listener = (event: { event: string; payload: unknown }) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitTauriEvent(event: string, payload?: unknown): void {
	for (const listener of listeners.get(event) ?? []) {
		listener({ event, payload });
	}
}

export function resetTauriEvents(): void {
	listeners.clear();
}

export async function listen<T = unknown>(
	event: string,
	handler: (event: { event: string; payload: T }) => void
): Promise<() => void> {
	const set = listeners.get(event) ?? new Set<Listener>();
	const listener = handler as Listener;
	set.add(listener);
	listeners.set(event, set);
	return () => {
		set.delete(listener);
	};
}

export async function emit(event: string, payload?: unknown): Promise<void> {
	emitTauriEvent(event, payload);
}
