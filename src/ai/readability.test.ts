import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	FADE_END,
	FADE_START,
	READABLE_LIMIT,
	backgroundOpacityAt,
	contrastOfWhiteTextOverWhiteWallpaper,
	messageDissolveLength
} from "./readability";

describe("backgroundOpacityAt", () => {
	it("is the full theme opacity above where the fade starts", () => {
		expect(backgroundOpacityAt(0.3)).toBeCloseTo(0.92, 5);
		expect(backgroundOpacityAt(FADE_START)).toBeCloseTo(0.92, 5);
	});

	it("is half the theme opacity halfway through the fade", () => {
		expect(backgroundOpacityAt((FADE_START + FADE_END) / 2)).toBeCloseTo(0.46, 5);
	});

	it("is fully transparent where the fade ends and below", () => {
		expect(backgroundOpacityAt(FADE_END)).toBe(0);
		expect(backgroundOpacityAt(1)).toBe(0);
	});
});

describe("the readable limit", () => {
	it("is the lowest point where white text still has AA contrast over a white wallpaper", () => {
		expect(
			contrastOfWhiteTextOverWhiteWallpaper(backgroundOpacityAt(READABLE_LIMIT))
		).toBeGreaterThanOrEqual(4.5);
		// Just below the limit it no longer is.
		expect(
			contrastOfWhiteTextOverWhiteWallpaper(backgroundOpacityAt(READABLE_LIMIT + 0.01))
		).toBeLessThan(4.5);
	});

	it("sits inside the fade, so text above 70% is never affected", () => {
		expect(READABLE_LIMIT).toBeGreaterThan(FADE_START);
		expect(READABLE_LIMIT).toBeLessThan(FADE_END);
	});

	it("is about four fifths of the way down the panel", () => {
		expect(READABLE_LIMIT).toBeGreaterThan(0.8);
		expect(READABLE_LIMIT).toBeLessThan(0.85);
	});
});

describe("messageDissolveLength", () => {
	it("is a gentle edge when the messages end above the readable limit", () => {
		// 380 px notch; the input block takes 90 px, so messages end at 290 (76%).
		expect(messageDissolveLength({ notchHeight: 380, belowMessagesHeight: 90 })).toBe(24);
	});

	it("grows when the messages reach into the part that is too faded to read", () => {
		// 600 px notch; the input block takes 90 px, so messages end at 510 (85%),
		// 18 px past the readable limit of about 492 px.
		const length = messageDissolveLength({ notchHeight: 600, belowMessagesHeight: 90 });

		expect(length).toBeGreaterThan(24);
		expect(length).toBeCloseTo(510 - READABLE_LIMIT * 600 + 24, 5);
	});

	it("is longer on a taller notch with the same input block", () => {
		const short = messageDissolveLength({ notchHeight: 400, belowMessagesHeight: 90 });
		const tall = messageDissolveLength({ notchHeight: 600, belowMessagesHeight: 90 });

		expect(tall).toBeGreaterThan(short);
	});
});

describe("the fade in the stylesheet", () => {
	const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
	const rule = css.match(/\.zara\.fade-bottom\s*\{([^}]*)\}/)?.[1] ?? "";

	it("starts where this file says it does", () => {
		expect(rule).toMatch(new RegExp(`--surface-fade-start:\\s*${FADE_START * 100}%`));
	});

	it("ends where this file says it does", () => {
		expect(rule).toMatch(new RegExp(`--surface-fade-end:\\s*${FADE_END * 100}%`));
	});
});
