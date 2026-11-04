import { describe, it, expect } from "vitest";
import { shouldAutoScroll } from "./scroll";

describe("shouldAutoScroll", () => {
	it("is true when scrolled exactly to the bottom", () => {
		expect(shouldAutoScroll({ scrollTop: 500, scrollHeight: 800, clientHeight: 300 })).toBe(true);
	});

	it("is true when 1px within the threshold", () => {
		// distanceFromBottom = 800 - 300 - 453 = 47, threshold defaults to 48
		expect(shouldAutoScroll({ scrollTop: 453, scrollHeight: 800, clientHeight: 300 })).toBe(true);
	});

	it("is false when 1px past the threshold", () => {
		// distanceFromBottom = 800 - 300 - 451 = 49, threshold defaults to 48
		expect(shouldAutoScroll({ scrollTop: 451, scrollHeight: 800, clientHeight: 300 })).toBe(false);
	});

	it("respects a custom threshold", () => {
		// distanceFromBottom = 100
		expect(shouldAutoScroll({ scrollTop: 400, scrollHeight: 800, clientHeight: 300 }, 100)).toBe(
			true
		);
		expect(shouldAutoScroll({ scrollTop: 400, scrollHeight: 800, clientHeight: 300 }, 99)).toBe(
			false
		);
	});

	it("is true for a zero-height container (nothing to scroll)", () => {
		expect(shouldAutoScroll({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
	});

	it("is true when content doesn't overflow (scrollHeight === clientHeight)", () => {
		expect(shouldAutoScroll({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true);
	});
});
