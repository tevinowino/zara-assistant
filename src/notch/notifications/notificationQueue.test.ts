import { describe, expect, it } from "vitest";
import {
	enqueueNotification,
	NOTIFICATION_MAX_WAIT_MS,
	takeNextNotification
} from "./notificationQueue";
import type { PillNotification } from "./notificationPolicy";

const pill = (id: number): PillNotification => ({
	id,
	appId: "Chat.App",
	appName: "Chat",
	appIcon: null,
	title: `Message ${id}`,
	body: "text"
});

describe("enqueueNotification", () => {
	it("adds a pill behind the ones waiting", () => {
		const queue = enqueueNotification(enqueueNotification([], pill(1), 1000), pill(2), 1000);

		expect(queue.map((queued) => queued.pill.id)).toEqual([1, 2]);
	});

	it("replaces a waiting pill that has the same id", () => {
		const first = { ...pill(1), body: "old" };
		const second = { ...pill(1), body: "new" };

		const queue = enqueueNotification(enqueueNotification([], first, 1000), second, 2000);

		expect(queue).toHaveLength(1);
		expect(queue[0].pill.body).toBe("new");
	});

	it("keeps only the newest three", () => {
		let queue = enqueueNotification([], pill(1), 1000);
		for (const id of [2, 3, 4, 5]) queue = enqueueNotification(queue, pill(id), 1000);

		expect(queue.map((queued) => queued.pill.id)).toEqual([3, 4, 5]);
	});
});

describe("takeNextNotification", () => {
	it("gives the oldest waiting pill and the rest", () => {
		let queue = enqueueNotification([], pill(1), 1000);
		queue = enqueueNotification(queue, pill(2), 1000);

		const { next, rest } = takeNextNotification(queue, 1500);

		expect(next?.id).toBe(1);
		expect(rest.map((queued) => queued.pill.id)).toEqual([2]);
	});

	it("gives nothing from an empty queue", () => {
		expect(takeNextNotification([], 1000)).toEqual({ next: null, rest: [] });
	});

	it("drops a pill that has waited too long to be news", () => {
		let queue = enqueueNotification([], pill(1), 1000);
		queue = enqueueNotification(queue, pill(2), 1000 + NOTIFICATION_MAX_WAIT_MS);

		const { next, rest } = takeNextNotification(queue, 1000 + NOTIFICATION_MAX_WAIT_MS + 1);

		expect(next?.id).toBe(2);
		expect(rest).toEqual([]);
	});

	it("still shows a pill that has waited exactly as long as allowed", () => {
		const queue = enqueueNotification([], pill(1), 1000);

		const { next } = takeNextNotification(queue, 1000 + NOTIFICATION_MAX_WAIT_MS);

		expect(next?.id).toBe(1);
	});
});
