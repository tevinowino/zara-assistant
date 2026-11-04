import { describe, it, expect } from "vitest";
import { hexToRgba } from "./color";

describe("hexToRgba", () => {
	it("converts a hex color to rgba at the given alpha", () => {
		expect(hexToRgba("#60a5fa", 0.14)).toBe("rgba(96, 165, 250, 0.14)");
	});

	it("handles pure black and pure white correctly", () => {
		expect(hexToRgba("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
		expect(hexToRgba("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
	});

	it("handles uppercase hex digits", () => {
		expect(hexToRgba("#FF0000", 0.4)).toBe("rgba(255, 0, 0, 0.4)");
	});

	it("supports alpha 0", () => {
		expect(hexToRgba("#123456", 0)).toBe("rgba(18, 52, 86, 0)");
	});
});
