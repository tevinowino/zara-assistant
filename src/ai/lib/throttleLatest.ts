/**
 * Passes on a stream of values no more often than every `intervalMs`, keeping only
 * the newest of those that arrive in between. It is for values that each replace
 * the one before (the answer so far, the reasoning so far), where showing every
 * step only costs work. The first value goes through at once, and the last one
 * always arrives: a value held back is delivered when the interval ends.
 */
export interface LatestThrottle<T> {
	push: (value: T) => void;
	/** Delivers a held-back value now, if there is one. */
	flush: () => void;
	/** Drops a held-back value and its timer, for when nobody is listening any more. */
	cancel: () => void;
}

export function throttleLatest<T>(
	deliver: (value: T) => void,
	intervalMs: number
): LatestThrottle<T> {
	let lastDeliveredAt = Number.NEGATIVE_INFINITY;
	let held: { value: T } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const deliverHeld = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		if (held === null) return;
		const { value } = held;
		held = null;
		lastDeliveredAt = Date.now();
		deliver(value);
	};

	return {
		push(value) {
			const wait = lastDeliveredAt + intervalMs - Date.now();
			if (wait <= 0 && timer === null) {
				lastDeliveredAt = Date.now();
				deliver(value);
				return;
			}
			held = { value };
			if (timer === null) timer = setTimeout(deliverHeld, Math.max(0, wait));
		},
		flush: deliverHeld,
		cancel() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			held = null;
		}
	};
}
