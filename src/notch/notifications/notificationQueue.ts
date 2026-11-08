import type { PillNotification } from "./notificationPolicy";

/** How many pills can wait behind the one showing; a burst should not hold the notch for long. */
export const NOTIFICATION_QUEUE_LIMIT = 3;
/** A pill that has waited this long is dropped: it is no longer news. */
export const NOTIFICATION_MAX_WAIT_MS = 15_000;

export interface QueuedNotification {
	pill: PillNotification;
	/** When it joined the queue, in milliseconds since the Unix epoch. */
	queuedAtMs: number;
}

/**
 * The queue with `pill` added at the end. A pill with the same id as one already waiting
 * replaces it, and only the newest `NOTIFICATION_QUEUE_LIMIT` are kept.
 */
export function enqueueNotification(
	queue: readonly QueuedNotification[],
	pill: PillNotification,
	nowMs: number
): QueuedNotification[] {
	const others = queue.filter((queued) => queued.pill.id !== pill.id);
	return [...others, { pill, queuedAtMs: nowMs }].slice(-NOTIFICATION_QUEUE_LIMIT);
}

/** The next pill to show (the oldest that is still news) and the queue without it. */
export function takeNextNotification(
	queue: readonly QueuedNotification[],
	nowMs: number
): { next: PillNotification | null; rest: QueuedNotification[] } {
	const fresh = queue.filter((queued) => nowMs - queued.queuedAtMs <= NOTIFICATION_MAX_WAIT_MS);
	const [first, ...rest] = fresh;
	return { next: first ? first.pill : null, rest };
}
