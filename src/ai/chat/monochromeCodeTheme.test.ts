import { describe, expect, it } from "vitest";
import { monochromeCodeTheme } from "./monochromeCodeTheme";

describe("monochromeCodeTheme", () => {
	it("never names a hue: every colour is inherited or a tint of the current text colour", () => {
		const colours = Object.values(monochromeCodeTheme)
			.map((style) => style.color)
			.filter((colour): colour is string => typeof colour === "string");

		expect(colours.length).toBeGreaterThan(10);
		for (const colour of colours) {
			expect(colour === "inherit" || colour.startsWith("color-mix(in srgb, currentColor")).toBe(true);
		}
	});

	it("separates keywords from ordinary code by weight, since colour is not available", () => {
		expect(monochromeCodeTheme.keyword.fontWeight).toBe(600);
		expect(monochromeCodeTheme.function.fontWeight).toBeUndefined();
	});

	it("leaves the code block's background to the panel", () => {
		expect(monochromeCodeTheme['pre[class*="language-"]'].background).toBe("none");
	});
});
