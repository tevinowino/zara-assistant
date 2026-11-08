import { describe, expect, it } from "vitest";
import {
	activeLineIndex,
	LYRICS_LOOKAHEAD_MS,
	lineToHighlight,
	parseLyricsOffset
} from "./activeLine";
import type { LyricLine } from "./lyricsTypes";

const song: LyricLine[] = [
	{ timeMs: 2_000, text: "first" },
	{ timeMs: 5_000, text: "second" },
	{ timeMs: 9_000, text: "third" }
];

describe("activeLineIndex", () => {
	it("is -1 before the first line starts", () => {
		expect(activeLineIndex(song, 1_999)).toBe(-1);
	});

	it("is the first line from the moment it starts", () => {
		expect(activeLineIndex(song, 2_000)).toBe(0);
	});

	it("stays on a line until the next one starts", () => {
		expect(activeLineIndex(song, 4_999)).toBe(0);
		expect(activeLineIndex(song, 5_000)).toBe(1);
	});

	it("stays on the last line after it starts", () => {
		expect(activeLineIndex(song, 9_000)).toBe(2);
		expect(activeLineIndex(song, 999_999)).toBe(2);
	});

	it("is -1 for a song with no lines", () => {
		expect(activeLineIndex([], 5_000)).toBe(-1);
	});

	it("finds the right line in a long song", () => {
		const long: LyricLine[] = Array.from({ length: 500 }, (_, index) => ({
			timeMs: index * 1_000,
			text: `line ${index}`
		}));

		expect(activeLineIndex(long, 250_500)).toBe(250);
	});
});

describe("lineToHighlight", () => {
	it("looks a little ahead so a line is not shown late", () => {
		const justBeforeSecond = 5_000 - LYRICS_LOOKAHEAD_MS;

		expect(lineToHighlight(song, justBeforeSecond, 0)).toBe(1);
		expect(lineToHighlight(song, justBeforeSecond - 1, 0)).toBe(0);
	});

	it("shows lyrics sooner for a positive offset", () => {
		expect(lineToHighlight(song, 4_000, 1_000)).toBe(1);
		expect(lineToHighlight(song, 4_000, 0)).toBe(0);
	});

	it("shows lyrics later for a negative offset", () => {
		expect(lineToHighlight(song, 5_100, -1_000)).toBe(0);
		expect(lineToHighlight(song, 5_100, 0)).toBe(1);
	});
});

describe("parseLyricsOffset", () => {
	it("reads a saved offset", () => {
		expect(parseLyricsOffset("750")).toBe(750);
		expect(parseLyricsOffset("-500")).toBe(-500);
	});

	it("is zero when nothing was saved or it is not a number", () => {
		expect(parseLyricsOffset(null)).toBe(0);
		expect(parseLyricsOffset(undefined)).toBe(0);
		expect(parseLyricsOffset("soon")).toBe(0);
	});

	it("keeps the offset within five seconds either way", () => {
		expect(parseLyricsOffset("99999")).toBe(5_000);
		expect(parseLyricsOffset("-99999")).toBe(-5_000);
	});
});
