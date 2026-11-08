import { describe, expect, it } from "vitest";
import { stateFromResult, trackKeyOf } from "./lyricsTypes";
import type { MediaInfo } from "../types";

const playing = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
	title: "Notice Me",
	artist: "Migos",
	is_playing: true,
	has_media: true,
	duration_ms: 234_400,
	...overrides
});

describe("trackKeyOf", () => {
	it("is null while nothing is playing", () => {
		expect(trackKeyOf(playing({ has_media: false }))).toBeNull();
	});

	it("is null while the title is empty", () => {
		expect(trackKeyOf(playing({ title: "  " }))).toBeNull();
	});

	it("is the same for the same artist, title and length", () => {
		expect(trackKeyOf(playing())).toBe(trackKeyOf(playing({ position_ms: 90_000 })));
	});

	it("differs when the title differs", () => {
		expect(trackKeyOf(playing())).not.toBe(trackKeyOf(playing({ title: "Another" })));
	});

	it("differs when the artist differs", () => {
		expect(trackKeyOf(playing())).not.toBe(trackKeyOf(playing({ artist: "Someone else" })));
	});

	it("ignores a length that differs by less than half a second", () => {
		expect(trackKeyOf(playing({ duration_ms: 234_400 }))).toBe(
			trackKeyOf(playing({ duration_ms: 234_100 }))
		);
	});

	it("still has a key when the player gives no length", () => {
		expect(trackKeyOf(playing({ duration_ms: undefined }))).not.toBeNull();
	});
});

describe("stateFromResult", () => {
	it("keeps the lines of synced lyrics", () => {
		const state = stateFromResult("key", {
			status: "synced",
			lines: [{ timeMs: 1_000, text: "La" }]
		});

		expect(state).toEqual({
			status: "synced",
			trackKey: "key",
			lines: [{ timeMs: 1_000, text: "La" }]
		});
	});

	it("keeps the text of plain lyrics", () => {
		expect(stateFromResult("key", { status: "plain", text: "words" })).toEqual({
			status: "plain",
			trackKey: "key",
			text: "words"
		});
	});

	it("carries the other answers as a status for the track", () => {
		expect(stateFromResult("key", { status: "instrumental" })).toEqual({
			status: "instrumental",
			trackKey: "key"
		});
		expect(stateFromResult("key", { status: "none" })).toEqual({ status: "none", trackKey: "key" });
		expect(stateFromResult("key", { status: "error" })).toEqual({
			status: "error",
			trackKey: "key"
		});
	});
});
