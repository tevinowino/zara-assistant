import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lyricsStore } from "../lyrics/lyricsStore";
import type { LyricLine, LyricsState } from "../lyrics/lyricsTypes";
import { CardLyrics, CardLyricsBackdrop } from "./CardLyrics";

const song: LyricLine[] = [
	{ timeMs: 1_000, text: "Line one" },
	{ timeMs: 3_000, text: "Line two" },
	{ timeMs: 5_000, text: "Line three" },
	{ timeMs: 7_000, text: "Line four" },
	{ timeMs: 9_000, text: "Line five" },
	{ timeMs: 11_000, text: "Line six" },
	{ timeMs: 13_000, text: "Line seven" }
];

const synced = (lines: LyricLine[] = song): LyricsState => ({
	status: "synced",
	trackKey: "k",
	lines
});

describe("CardLyrics", () => {
	beforeEach(() => {
		lyricsStore.reset();
	});

	it("marks the line being sung", () => {
		render(<CardLyrics state={synced()} activeIndex={3} />);

		expect(screen.getByText("Line four")).toHaveAttribute("aria-current", "true");
		expect(screen.getByText("Line three")).not.toHaveAttribute("aria-current");
	});

	it("shows two lines before and two after the line being sung", () => {
		render(<CardLyrics state={synced()} activeIndex={3} />);

		expect(screen.getByText("Line two")).toBeInTheDocument();
		expect(screen.getByText("Line three")).toBeInTheDocument();
		expect(screen.getByText("Line five")).toBeInTheDocument();
		expect(screen.getByText("Line six")).toBeInTheDocument();
		expect(screen.queryByText("Line one")).not.toBeInTheDocument();
		expect(screen.queryByText("Line seven")).not.toBeInTheDocument();
	});

	it("shows the first lines, with none marked, before the song's first line starts", () => {
		render(<CardLyrics state={synced()} activeIndex={-1} />);

		expect(screen.getByText("Line one")).toBeInTheDocument();
		expect(document.querySelector("[aria-current='true']")).not.toBeInTheDocument();
	});

	it("shows the last lines at the end of the song", () => {
		render(<CardLyrics state={synced()} activeIndex={6} />);

		expect(screen.getByText("Line seven")).toHaveAttribute("aria-current", "true");
		expect(screen.getByText("Line five")).toBeInTheDocument();
	});

	it("shows an instrumental break as a note", () => {
		const withBreak = synced([
			{ timeMs: 1_000, text: "Sung" },
			{ timeMs: 3_000, text: "" }
		]);

		render(<CardLyrics state={withBreak} activeIndex={1} />);

		expect(screen.getByText("♪")).toHaveAttribute("aria-current", "true");
	});

	it("shows lyrics without timing as plain text", () => {
		render(
			<CardLyrics
				state={{ status: "plain", trackKey: "k", text: "Some words\nMore words" }}
				activeIndex={-1}
			/>
		);

		expect(screen.getByText(/Some words/)).toBeInTheDocument();
	});

	it("invites the user to play something when nothing is playing", () => {
		render(<CardLyrics state={{ status: "idle" }} activeIndex={-1} />);

		expect(screen.getByText("Play something to see its lyrics.")).toBeInTheDocument();
	});

	it("says it is looking while the lyrics load", () => {
		render(<CardLyrics state={{ status: "loading", trackKey: "k" }} activeIndex={-1} />);

		expect(screen.getByText("Looking for the lyrics…")).toBeInTheDocument();
	});

	it("says when there are no lyrics for the song", () => {
		render(<CardLyrics state={{ status: "none", trackKey: "k" }} activeIndex={-1} />);

		expect(screen.getByText("No lyrics found for this song.")).toBeInTheDocument();
	});

	it("says when the song has no words", () => {
		render(<CardLyrics state={{ status: "instrumental", trackKey: "k" }} activeIndex={-1} />);

		expect(screen.getByText("No words in this one. Just listen.")).toBeInTheDocument();
	});

	it("offers to try again after an error, which asks for the lyrics again", async () => {
		render(<CardLyrics state={{ status: "error", trackKey: "k" }} activeIndex={-1} />);
		const before = lyricsStore.getRetryCount();

		await userEvent.click(screen.getByRole("button", { name: /Try again/ }));

		expect(lyricsStore.getRetryCount()).toBe(before + 1);
	});
});

describe("CardLyricsBackdrop", () => {
	it("is decoration: hidden from screen readers and holding no text", () => {
		const { container } = render(<CardLyricsBackdrop />);

		const backdrop = container.querySelector(".mcard-lyrics-backdrop");
		expect(backdrop).toHaveAttribute("aria-hidden", "true");
		expect(backdrop).toHaveTextContent("");
	});

	it("blurs in several small steps, so the blur grows gradually toward the middle", () => {
		const { container } = render(<CardLyricsBackdrop />);

		const heights = [...container.querySelectorAll<HTMLElement>(".mcard-lyrics-blur")].map(
			(strip) => Number.parseFloat(strip.style.height)
		);

		expect(heights.length).toBeGreaterThanOrEqual(6);
		expect(heights).toEqual([...heights].sort((a, b) => b - a));
		expect(new Set(heights).size).toBe(heights.length);
	});

	it("has a dark band behind the lyrics for contrast", () => {
		const { container } = render(<CardLyricsBackdrop />);

		expect(container.querySelector(".mcard-lyrics-shade")).toBeInTheDocument();
	});
});
