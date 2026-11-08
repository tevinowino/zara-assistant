import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { MediaInfo } from "../types";
import { lyricsStore } from "./lyricsStore";
import { useTrackLyrics } from "./useTrackLyrics";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

const playing = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
	title: "Notice Me",
	artist: "Migos",
	is_playing: true,
	has_media: true,
	duration_ms: 234_400,
	...overrides
});

const snapshot = (mediaInfo: MediaInfo) => ({ mediaInfo, isPlaying: mediaInfo.is_playing });

describe("useTrackLyrics", () => {
	beforeEach(() => {
		lyricsStore.reset();
	});

	it("asks for nothing while the Lyrics widget is off", () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));

		renderHook(() => useTrackLyrics(false, snapshot(playing())));

		expect(callsTo("lyrics_for_track")).toHaveLength(0);
		expect(lyricsStore.get()).toEqual({ status: "idle" });
	});

	it("asks for nothing while nothing is playing", () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));

		renderHook(() => useTrackLyrics(true, snapshot(playing({ has_media: false }))));

		expect(callsTo("lyrics_for_track")).toHaveLength(0);
		expect(lyricsStore.get()).toEqual({ status: "idle" });
	});

	it("asks for the lyrics of the track that is playing and keeps the answer", async () => {
		setInvokeHandler("lyrics_for_track", () => ({
			status: "synced",
			lines: [{ timeMs: 1_000, text: "La" }]
		}));

		renderHook(() => useTrackLyrics(true, snapshot(playing())));

		await waitFor(() => expect(lyricsStore.get().status).toBe("synced"));
		expect(callsTo("lyrics_for_track")[0].args).toEqual({
			title: "Notice Me",
			artist: "Migos",
			durationMs: 234_400
		});
	});

	it("says it is loading until the answer comes", () => {
		setInvokeHandler("lyrics_for_track", () => new Promise(() => {}));

		renderHook(() => useTrackLyrics(true, snapshot(playing())));

		expect(lyricsStore.get().status).toBe("loading");
	});

	it("does not ask again while the same track keeps playing", async () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));
		const { rerender } = renderHook(({ info }) => useTrackLyrics(true, snapshot(info)), {
			initialProps: { info: playing({ position_ms: 1_000 }) }
		});
		await waitFor(() => expect(lyricsStore.get().status).toBe("none"));

		rerender({ info: playing({ position_ms: 61_000 }) });

		expect(callsTo("lyrics_for_track")).toHaveLength(1);
	});

	it("asks again when the track changes", async () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));
		const { rerender } = renderHook(({ info }) => useTrackLyrics(true, snapshot(info)), {
			initialProps: { info: playing() }
		});
		await waitFor(() => expect(lyricsStore.get().status).toBe("none"));

		rerender({ info: playing({ title: "Another song" }) });

		await waitFor(() => expect(callsTo("lyrics_for_track")).toHaveLength(2));
		expect(callsTo("lyrics_for_track")[1].args?.title).toBe("Another song");
	});

	it("ignores an answer that arrives after the track has changed", async () => {
		let answerFirst: (value: unknown) => void = () => {};
		setInvokeHandler("lyrics_for_track", (args) =>
			args?.title === "Notice Me"
				? new Promise((resolve) => {
						answerFirst = resolve;
					})
				: { status: "plain", text: "second song words" }
		);
		const { rerender } = renderHook(({ info }) => useTrackLyrics(true, snapshot(info)), {
			initialProps: { info: playing() }
		});
		rerender({ info: playing({ title: "Another song" }) });
		await waitFor(() => expect(lyricsStore.get().status).toBe("plain"));

		await act(async () => {
			answerFirst({ status: "synced", lines: [{ timeMs: 0, text: "late" }] });
		});

		expect(lyricsStore.get().status).toBe("plain");
	});

	it("shows an error when the backend fails", async () => {
		setInvokeHandler("lyrics_for_track", () => {
			throw new Error("backend down");
		});

		renderHook(() => useTrackLyrics(true, snapshot(playing())));

		await waitFor(() => expect(lyricsStore.get().status).toBe("error"));
	});

	it("asks again when a retry is requested", async () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "error" }));
		renderHook(() => useTrackLyrics(true, snapshot(playing())));
		await waitFor(() => expect(lyricsStore.get().status).toBe("error"));

		act(() => lyricsStore.retry());

		await waitFor(() => expect(callsTo("lyrics_for_track")).toHaveLength(2));
	});

	it("forgets the lyrics when the widget is turned off", async () => {
		setInvokeHandler("lyrics_for_track", () => ({ status: "plain", text: "words" }));
		const { rerender } = renderHook(({ on }) => useTrackLyrics(on, snapshot(playing())), {
			initialProps: { on: true }
		});
		await waitFor(() => expect(lyricsStore.get().status).toBe("plain"));

		rerender({ on: false });

		expect(lyricsStore.get()).toEqual({ status: "idle" });
	});
});
