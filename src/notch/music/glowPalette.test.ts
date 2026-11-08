import { describe, expect, it } from "vitest";
import { extractGlowPalette, glowBackground, NEUTRAL_GLOW, type GlowColor } from "./glowPalette";

/** RGBA bytes for `count` pixels of one color. */
function pixels(r: number, g: number, b: number, count: number, a = 255): number[] {
	return Array.from({ length: count }, () => [r, g, b, a]).flat();
}

/** The hue of a glow color in degrees, 0-360. */
function hueOf({ r, g, b }: GlowColor): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) return 0;
	let hue: number;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	hue *= 60;
	return hue < 0 ? hue + 360 : hue;
}

const isNear = (hue: number, target: number, within: number) => {
	const apart = Math.abs(hue - target) % 360;
	return Math.min(apart, 360 - apart) <= within;
};

describe("extractGlowPalette", () => {
	it("glows red then purple for a cover that is mostly red with some purple", () => {
		const cover = [...pixels(200, 30, 40, 700), ...pixels(130, 40, 200, 300)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(2);
		expect(isNear(hueOf(palette[0]), 355, 15)).toBe(true);
		expect(isNear(hueOf(palette[1]), 270, 20)).toBe(true);
		expect(palette[0].weight).toBeGreaterThan(palette[1].weight);
	});

	it("shares of the glow add up to one", () => {
		const cover = [
			...pixels(200, 30, 40, 500),
			...pixels(130, 40, 200, 300),
			...pixels(30, 180, 90, 200)
		];

		const palette = extractGlowPalette(cover);

		const total = palette.reduce((sum, color) => sum + color.weight, 0);
		expect(total).toBeCloseTo(1, 5);
	});

	it("glows one color for a cover of one color, whatever its shades", () => {
		const cover = [
			...pixels(200, 30, 40, 400),
			...pixels(225, 60, 55, 300),
			...pixels(170, 20, 35, 300)
		];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
		expect(isNear(hueOf(palette[0]), 355, 15)).toBe(true);
	});

	it("keeps a red that sits either side of the start of the color wheel as one red", () => {
		const cover = [...pixels(220, 20, 30, 400), ...pixels(220, 20, 70, 400)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
	});

	it("ignores black borders around a blue cover", () => {
		const cover = [...pixels(0, 0, 0, 800), ...pixels(40, 90, 220, 200)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
		expect(isNear(hueOf(palette[0]), 222, 15)).toBe(true);
	});

	it("ignores white borders around a green cover", () => {
		const cover = [...pixels(255, 255, 255, 800), ...pixels(40, 190, 90, 200)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
		expect(isNear(hueOf(palette[0]), 138, 15)).toBe(true);
	});

	it("ignores see-through pixels", () => {
		const cover = [...pixels(40, 90, 220, 200), ...pixels(220, 30, 30, 800, 20)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
		expect(isNear(hueOf(palette[0]), 222, 15)).toBe(true);
	});

	it("gives a cover with no color the neutral glow", () => {
		const cover = [...pixels(120, 120, 120, 500), ...pixels(40, 40, 40, 500)];

		expect(extractGlowPalette(cover)).toEqual([...NEUTRAL_GLOW]);
	});

	it("gives no pixels the neutral glow", () => {
		expect(extractGlowPalette([])).toEqual([...NEUTRAL_GLOW]);
	});

	it("lifts a dark red into a glow that reads as light", () => {
		const cover = pixels(90, 10, 15, 500);

		const [color] = extractGlowPalette(cover);

		expect(Math.max(color.r, color.g, color.b)).toBeGreaterThan(180);
	});

	it("drops a color that is only a speck of the cover", () => {
		const cover = [...pixels(200, 30, 40, 990), ...pixels(40, 90, 220, 10)];

		const palette = extractGlowPalette(cover);

		expect(palette).toHaveLength(1);
	});

	it("never glows more than three colors", () => {
		const cover = [
			...pixels(220, 30, 30, 250),
			...pixels(230, 200, 30, 250),
			...pixels(30, 200, 60, 250),
			...pixels(30, 90, 230, 250)
		];

		expect(extractGlowPalette(cover).length).toBeLessThanOrEqual(3);
	});
});

describe("glowBackground", () => {
	it("draws one soft light for each color", () => {
		const palette: GlowColor[] = [
			{ r: 220, g: 40, b: 50, weight: 0.7 },
			{ r: 140, g: 60, b: 210, weight: 0.3 }
		];

		const css = glowBackground(palette);

		expect(css.match(/radial-gradient/g)).toHaveLength(2);
		expect(css).toContain("rgba(220, 40, 50, 0.9)");
		expect(css).toContain("rgba(140, 60, 210, 0.9)");
	});

	it("lists the strongest color first, so it is painted on top", () => {
		const palette: GlowColor[] = [
			{ r: 220, g: 40, b: 50, weight: 0.7 },
			{ r: 140, g: 60, b: 210, weight: 0.3 }
		];

		const css = glowBackground(palette);

		expect(css.indexOf("220, 40, 50")).toBeLessThan(css.indexOf("140, 60, 210"));
	});

	it("makes a stronger color reach further than a weaker one", () => {
		const strong = glowBackground([{ r: 1, g: 2, b: 3, weight: 0.9 }]);
		const weak = glowBackground([{ r: 1, g: 2, b: 3, weight: 0.2 }]);

		const reachOf = (css: string) => Number(/radial-gradient\((\d+)%/.exec(css)?.[1]);
		expect(reachOf(strong)).toBeGreaterThan(reachOf(weak));
	});
});
