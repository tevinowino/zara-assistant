import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { lyricsStore } from "../lyrics/lyricsStore";
import type { LyricLine, MediaSnapshot } from "../lyrics/lyricsTypes";
import { LyricsPanel } from "./LyricsPanel";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

const song: LyricLine[] = [
	{ timeMs: 2_000, text: "First line" },
	{ timeMs: 5_000, text: "Second line" },
	{ timeMs: 9_000, text: "" },
	{ timeMs: 12_000, text: "Third line" }
];

/** Notice Me by Migos, paused at `positionMs` so the highlighted line does not move. */
function pausedAt(positionMs: number): MediaSnapshot {
	return {
		mediaInfo: {
			title: "Notice Me",
			artist: "Migos",
			is_playing: false,
			has_media: true,
			position_ms: positionMs,
			position_updated_at: Date.now(),
			duration_ms: 234_000
		},
		isPlaying: false
	};
}

function renderPanel(
	options: { positionMs?: number; zaraMode?: "lyrics" | "calendar"; askZara?: () => void } = {}
) {
	const askZara = options.askZara ?? vi.fn();
	render(
		<LyricsPanel
			zaraMode={options.zaraMode ?? "lyrics"}
			media={pausedAt(options.positionMs ?? 0)}
			askZara={askZara}
		/>
	);
	return { askZara };
}

describe("LyricsPanel", () => {
	beforeEach(() => {
		localStorage.clear();
		lyricsStore.reset();
		setInvokeHandler("save_setting", () => undefined);
	});

	it("is not drawn on another view", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel({ zaraMode: "calendar" });

		expect(screen.queryByText("First line")).not.toBeInTheDocument();
	});

	it("invites the user to play something when nothing is playing", () => {
		renderPanel();

		expect(screen.getByText("Play something to see its lyrics.")).toBeInTheDocument();
	});

	it("says it is looking while the lyrics load", () => {
		lyricsStore.set({ status: "loading", trackKey: "k" });

		renderPanel();

		expect(screen.getByText("Looking for the lyrics…")).toBeInTheDocument();
	});

	it("says when there are no lyrics for the song", () => {
		lyricsStore.set({ status: "none", trackKey: "k" });

		renderPanel();

		expect(screen.getByText("No lyrics found for this song.")).toBeInTheDocument();
	});

	it("says when the song has no words", () => {
		lyricsStore.set({ status: "instrumental", trackKey: "k" });

		renderPanel();

		expect(screen.getByText("This one has no words. Just listen.")).toBeInTheDocument();
	});

	it("shows lyrics that have no timing as plain text", () => {
		lyricsStore.set({ status: "plain", trackKey: "k", text: "Some words\nMore words" });

		renderPanel();

		expect(screen.getByLabelText("Lyrics")).toHaveTextContent("Some words");
		expect(screen.getByLabelText("Lyrics")).toHaveTextContent("More words");
	});

	it("offers to try again after an error, which asks for the lyrics again", async () => {
		lyricsStore.set({ status: "error", trackKey: "k" });
		renderPanel();
		const before = lyricsStore.getRetryCount();

		await userEvent.click(screen.getByRole("button", { name: /Try again/ }));

		expect(lyricsStore.getRetryCount()).toBe(before + 1);
	});

	it("shows the song's name", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel();

		expect(screen.getByText("Migos — Notice Me")).toBeInTheDocument();
	});

	it("lists every line of a synced song", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel();

		expect(screen.getByRole("button", { name: "First line" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Second line" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Third line" })).toBeInTheDocument();
	});

	it("highlights the line being sung", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel({ positionMs: 6_000 });

		expect(screen.getByRole("button", { name: "Second line" }).closest("li")).toHaveAttribute(
			"aria-current",
			"true"
		);
		expect(screen.getByRole("button", { name: "First line" }).closest("li")).not.toHaveAttribute(
			"aria-current"
		);
	});

	it("highlights nothing before the first line", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel({ positionMs: 500 });

		expect(document.querySelector("[aria-current='true']")).not.toBeInTheDocument();
	});

	it("shows an instrumental break as a note, not a line to click", () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel();

		expect(screen.getByText("♪")).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: /line/ })).toHaveLength(3);
	});

	it("offers to save or ask about a line once it is clicked", async () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();
		expect(screen.queryByRole("button", { name: "Save to Notes" })).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Second line" }));

		expect(screen.getByRole("button", { name: "Save to Notes" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Ask Zara" })).toBeInTheDocument();
	});

	it("saves the clicked line as a note titled with the song", async () => {
		setInvokeHandler("note_add", () => ({ id: "n1" }));
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();
		await userEvent.click(screen.getByRole("button", { name: "Second line" }));

		await userEvent.click(screen.getByRole("button", { name: "Save to Notes" }));

		await waitFor(() => expect(callsTo("note_add")).toHaveLength(1));
		expect(callsTo("note_add")[0].args).toMatchObject({
			text: "Second line",
			title: "Migos — Notice Me"
		});
		expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
	});

	it("does not say it saved when the note could not be saved", async () => {
		setInvokeHandler("note_add", () => {
			throw new Error("disk full");
		});
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();
		await userEvent.click(screen.getByRole("button", { name: "Second line" }));

		await userEvent.click(screen.getByRole("button", { name: "Save to Notes" }));

		await waitFor(() => expect(callsTo("note_add")).toHaveLength(1));
		expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
	});

	it("asks the assistant about the clicked line", async () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		const { askZara } = renderPanel();
		await userEvent.click(screen.getByRole("button", { name: "Third line" }));

		await userEvent.click(screen.getByRole("button", { name: "Ask Zara" }));

		expect(askZara).toHaveBeenCalledWith(
			"What does this lyric mean? “Third line” — Migos — Notice Me"
		);
	});

	it("clears the selection when the song changes", async () => {
		lyricsStore.set({ status: "synced", trackKey: "first", lines: song });
		renderPanel();
		await userEvent.click(screen.getByRole("button", { name: "Second line" }));

		act(() => lyricsStore.set({ status: "synced", trackKey: "second", lines: song }));

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Save to Notes" })).not.toBeInTheDocument()
		);
	});

	it("moves the lyrics sooner and saves the timing", async () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();

		await userEvent.click(screen.getByRole("button", { name: "Show lyrics sooner" }));

		expect(screen.getByRole("button", { name: "Reset lyrics timing" })).toHaveTextContent("0.25s");
		expect(callsTo("save_setting").at(-1)?.args).toEqual({
			key: "zara-lyrics-offset-ms",
			value: "250"
		});
	});

	it("moves the lyrics later and saves the timing", async () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();

		await userEvent.click(screen.getByRole("button", { name: "Show lyrics later" }));

		expect(screen.getByRole("button", { name: "Reset lyrics timing" })).toHaveTextContent("-0.25s");
		expect(callsTo("save_setting").at(-1)?.args).toEqual({
			key: "zara-lyrics-offset-ms",
			value: "-250"
		});
	});

	it("starts from the timing the user saved", () => {
		localStorage.setItem("zara-lyrics-offset-ms", "500");
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });

		renderPanel();

		expect(screen.getByRole("button", { name: "Reset lyrics timing" })).toHaveTextContent("0.50s");
	});

	it("puts the timing back to zero", async () => {
		localStorage.setItem("zara-lyrics-offset-ms", "500");
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		renderPanel();

		await userEvent.click(screen.getByRole("button", { name: "Reset lyrics timing" }));

		expect(screen.getByRole("button", { name: "Reset lyrics timing" })).toHaveTextContent("0.00s");
	});

	it("shows a line sooner once the lyrics are moved sooner", async () => {
		lyricsStore.set({ status: "synced", trackKey: "k", lines: song });
		localStorage.setItem("zara-lyrics-offset-ms", "1000");

		renderPanel({ positionMs: 4_000 });

		expect(screen.getByRole("button", { name: "Second line" }).closest("li")).toHaveAttribute(
			"aria-current",
			"true"
		);
	});

	it("hides the timing controls when the lyrics have no timing to move", () => {
		lyricsStore.set({ status: "plain", trackKey: "k", text: "Words" });

		renderPanel();

		expect(screen.queryByRole("group", { name: "Lyrics timing" })).not.toBeInTheDocument();
	});
});
