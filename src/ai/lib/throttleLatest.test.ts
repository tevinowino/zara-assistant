import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttleLatest } from "./throttleLatest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("throttleLatest", () => {
	it("passes the first value on at once", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);

		throttle.push("first");

		expect(delivered).toEqual(["first"]);
	});

	it("holds back values that arrive within the interval and delivers only the newest, when it ends", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);

		throttle.push("a");
		throttle.push("b");
		throttle.push("c");
		expect(delivered).toEqual(["a"]);
		vi.advanceTimersByTime(100);

		expect(delivered).toEqual(["a", "c"]);
	});

	it("passes a value on at once when the interval has already passed", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);
		throttle.push("a");

		vi.advanceTimersByTime(250);
		throttle.push("b");

		expect(delivered).toEqual(["a", "b"]);
	});

	it("turns a flood of values into a handful of deliveries", () => {
		const delivered: number[] = [];
		const throttle = throttleLatest<number>((value) => delivered.push(value), 100);

		for (let step = 0; step < 2000; step += 1) {
			throttle.push(step);
			vi.advanceTimersByTime(1);
		}
		vi.advanceTimersByTime(100);

		expect(delivered.length).toBeLessThan(30);
		expect(delivered[delivered.length - 1]).toBe(1999);
	});

	it("delivers a held-back value right away when flushed", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);
		throttle.push("a");
		throttle.push("b");

		throttle.flush();

		expect(delivered).toEqual(["a", "b"]);
		vi.advanceTimersByTime(500);
		expect(delivered).toEqual(["a", "b"]);
	});

	it("flushing with nothing held does nothing", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);

		throttle.flush();

		expect(delivered).toEqual([]);
	});

	it("drops a held-back value when cancelled", () => {
		const delivered: string[] = [];
		const throttle = throttleLatest<string>((value) => delivered.push(value), 100);
		throttle.push("a");
		throttle.push("b");

		throttle.cancel();
		vi.advanceTimersByTime(500);

		expect(delivered).toEqual(["a"]);
	});
});
