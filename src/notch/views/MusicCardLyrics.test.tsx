import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { animationControls } from "framer-motion";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { useMediaPlayback } from "../hooks/useMediaPlayback";
import { lyricsStore } from "../lyrics/lyricsStore";
import { WidgetBackgrounds } from "../widgets/registry";
import { MusicCard, type MusicCardProps } from "./MusicCard";
import { MusicCardView } from "./MusicCardView";

type Media = ReturnType<typeof useMediaPlayback>;

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

/** Notice Me by Migos, playing, 0:05 into 3:54, with a cover. */
function playingMedia(): Media {
	return {
		isPlaying: true,
		mediaInfo: {
			title: "Notice Me",
			artist: "Migos",
			is_playing: true,
			has_media: true,
			position_ms: 5_000,
			duration_ms: 234_000,
			seek_enabled: true,
			position_updated_at: Date.now()
		},
		albumArtUrl: "data:image/png;base64,cover",
		albumArtKey: 1,
		displayVolume: 0.4,
		togglePlayPause: vi.fn(),
		prevFront: animationControls(),
		prevBack: animationControls(),
		nextFront: animationControls(),
		nextBack: animationControls(),
		animatePrev: vi.fn(),
		animateNext: vi.fn(),
		handleVolumeChange: vi.fn()
	} as unknown as Media;
}

/** The card as the notch has it: the card itself, and the background jobs the notch mounts. */
function renderNotch(media: Media) {
	return render(
		<>
			<WidgetBackgrounds
				preferences={{ enabled: ["ai"] }}
				active
				media={{ mediaInfo: media.mediaInfo, isPlaying: media.isPlaying }}
			/>
			<MusicCardView media={media} />
		</>
	);
}

describe("the music card's lyrics button", () => {
	beforeEach(() => {
		localStorage.clear();
		lyricsStore.reset();
		setInvokeHandler("save_setting", () => undefined);
		setInvokeHandler("clipboard_history_enable", () => null);
		setInvokeHandler("claude_code_enable", () => undefined);
		setInvokeHandler("lyrics_for_track", () => ({
			status: "synced",
			lines: [
				{ timeMs: 1_000, text: "First lyric line" },
				{ timeMs: 9_000, text: "Second lyric line" }
			]
		}));
	});

	it("looks nothing up while the lyrics are off, though the Lyrics widget is also off", () => {
		renderNotch(playingMedia());

		expect(callsTo("lyrics_for_track")).toHaveLength(0);
		expect(screen.getByRole("button", { name: "Lyrics" })).toHaveAttribute("aria-pressed", "false");
	});

	it("looks up the playing song and shows its lyrics once the button is pressed", async () => {
		renderNotch(playingMedia());

		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));

		await waitFor(() => expect(callsTo("lyrics_for_track")).toHaveLength(1));
		expect(callsTo("lyrics_for_track")[0].args).toMatchObject({
			title: "Notice Me",
			artist: "Migos"
		});
		expect(await screen.findByText("First lyric line")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Lyrics" })).toHaveAttribute("aria-pressed", "true");
	});

	it("highlights the line being sung at the playhead", async () => {
		renderNotch(playingMedia());

		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));

		// 0:05 is after the first line (0:01) and before the second (0:09).
		expect(await screen.findByText("First lyric line")).toHaveAttribute("aria-current", "true");
	});

	it("remembers that the lyrics are on", async () => {
		renderNotch(playingMedia());

		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));

		expect(callsTo("save_setting").at(-1)?.args).toEqual({
			key: "zara-card-lyrics",
			value: "true"
		});
	});

	it("hides the lyrics and stops looking things up when the button is pressed again", async () => {
		renderNotch(playingMedia());
		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));
		await screen.findByText("First lyric line");

		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));

		await waitFor(() => expect(screen.queryByText("First lyric line")).not.toBeInTheDocument());
		expect(lyricsStore.getCardWantsLyrics()).toBe(false);
	});

	it("stops wanting lyrics when the card goes away, so nothing is looked up for a closed notch", async () => {
		const { unmount } = renderNotch(playingMedia());
		await userEvent.click(screen.getByRole("button", { name: "Lyrics" }));
		await waitFor(() => expect(lyricsStore.getCardWantsLyrics()).toBe(true));

		unmount();

		expect(lyricsStore.getCardWantsLyrics()).toBe(false);
	});

	it("shows the lyrics at once when the user left them on", async () => {
		localStorage.setItem("zara-card-lyrics", "true");

		renderNotch(playingMedia());

		expect(await screen.findByText("First lyric line")).toBeInTheDocument();
	});
});

describe("MusicCard without a lyrics button", () => {
	it("has no lyrics button, as in the Settings preview", () => {
		const props: MusicCardProps = {
			title: "Sample track",
			artist: "Zara preview",
			artUrl: null,
			artKey: 0,
			isPlaying: true,
			positionMs: 0,
			durationMs: 0,
			seekEnabled: false,
			onSeekStart: vi.fn(),
			onSeekChange: vi.fn(),
			onSeekEnd: vi.fn(),
			volume: 0.5,
			onVolumeChange: vi.fn(),
			onTogglePlayPause: vi.fn(),
			onPrevious: vi.fn(),
			onNext: vi.fn(),
			onOpenAudioOutput: vi.fn()
		};

		render(<MusicCard {...props} />);

		expect(screen.queryByRole("button", { name: "Lyrics" })).not.toBeInTheDocument();
	});
});

describe("the layers of the music card while lyrics show", () => {
	const cardProps: MusicCardProps = {
		title: "Ghost",
		artist: "Jhené Aiko",
		artUrl: "data:image/png;base64,cover",
		artKey: 1,
		isPlaying: true,
		positionMs: 62_000,
		durationMs: 122_000,
		seekEnabled: false,
		onSeekStart: vi.fn(),
		onSeekChange: vi.fn(),
		onSeekEnd: vi.fn(),
		volume: 0.3,
		onVolumeChange: vi.fn(),
		onTogglePlayPause: vi.fn(),
		onPrevious: vi.fn(),
		onNext: vi.fn(),
		onOpenAudioOutput: vi.fn()
	};
	const synced = {
		status: "synced" as const,
		trackKey: "k",
		lines: [
			{ timeMs: 1_000, text: "A line before" },
			{ timeMs: 5_000, text: "The line being sung" }
		]
	};

	it("draws a graded backdrop behind the lyrics and marks the card", () => {
		const { container } = render(
			<MusicCard
				{...cardProps}
				lyrics={{ shown: true, onToggle: vi.fn(), state: synced, activeIndex: 1 }}
			/>
		);

		expect(container.querySelector(".mcard")).toHaveClass("mcard-lyrics-on");
		expect(container.querySelector(".mcard-lyrics-backdrop")).toBeInTheDocument();
		expect(screen.getByText("The line being sung")).toBeInTheDocument();
	});

	it("keeps the lyrics outside the artist band and the controls, so nothing blurs or covers them", () => {
		const { container } = render(
			<MusicCard
				{...cardProps}
				lyrics={{ shown: true, onToggle: vi.fn(), state: synced, activeIndex: 1 }}
			/>
		);

		const lyricsText = screen.getByText("The line being sung");
		expect(lyricsText.closest(".mcard-top")).toBeNull();
		expect(lyricsText.closest(".mcard-bottom")).toBeNull();
		expect(lyricsText.closest(".mcard-lyrics")).toBeInTheDocument();
		expect(container.querySelector(".mcard-lyrics-backdrop .mcard-lyrics-line")).toBeNull();
	});

	it("has no backdrop and no lyrics mark while the lyrics are hidden", () => {
		const { container } = render(
			<MusicCard
				{...cardProps}
				lyrics={{ shown: false, onToggle: vi.fn(), state: synced, activeIndex: 1 }}
			/>
		);

		expect(container.querySelector(".mcard")).not.toHaveClass("mcard-lyrics-on");
		expect(container.querySelector(".mcard-lyrics-backdrop")).not.toBeInTheDocument();
		expect(screen.queryByText("The line being sung")).not.toBeInTheDocument();
	});
});
