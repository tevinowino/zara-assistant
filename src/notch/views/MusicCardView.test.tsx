import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { animationControls } from "framer-motion";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { useMediaPlayback } from "../hooks/useMediaPlayback";
import { MusicCardView } from "./MusicCardView";

type Media = ReturnType<typeof useMediaPlayback>;

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

/** The media hook's result for "Notice me" by Migos, playing, 0:52 into 2:13. */
function playingMedia(overrides: Partial<Media> = {}): Media {
	return {
		isPlaying: true,
		mediaInfo: {
			title: "Notice me",
			artist: "Migos",
			is_playing: true,
			has_media: true,
			position_ms: 52_000,
			duration_ms: 133_000,
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
		handleVolumeChange: vi.fn(),
		...overrides
	} as unknown as Media;
}

describe("MusicCardView", () => {
	it("shows the track that is playing", () => {
		render(<MusicCardView media={playingMedia()} />);

		expect(screen.getByText("Migos")).toBeInTheDocument();
		expect(screen.getByText("Notice me")).toBeInTheDocument();
	});

	it("plays and pauses through the media controls", async () => {
		const media = playingMedia();
		render(<MusicCardView media={media} />);

		await userEvent.click(screen.getByRole("button", { name: "Pause" }));

		expect(media.togglePlayPause).toHaveBeenCalledTimes(1);
	});

	it("skips tracks through the media controls, which also slide the icons", async () => {
		const media = playingMedia();
		render(<MusicCardView media={media} />);

		await userEvent.click(screen.getByRole("button", { name: "Previous track" }));
		await userEvent.click(screen.getByRole("button", { name: "Next track" }));

		expect(media.animatePrev).toHaveBeenCalledTimes(1);
		expect(media.animateNext).toHaveBeenCalledTimes(1);
	});

	it("sets the system volume from the slider", () => {
		const media = playingMedia();
		render(<MusicCardView media={media} />);

		fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.8" } });

		expect(media.handleVolumeChange).toHaveBeenCalledWith(0.8);
	});

	it("tells the player where to seek when the user lets go of the bar", () => {
		setInvokeHandler("media_seek", () => undefined);
		render(<MusicCardView media={playingMedia()} />);
		const seekBar = screen.getByRole("slider", { name: "Seek" });

		fireEvent.mouseDown(seekBar);
		fireEvent.change(seekBar, { target: { value: "90000" } });
		fireEvent.mouseUp(seekBar);

		expect(callsTo("media_seek").at(-1)?.args).toEqual({ positionMs: 90_000 });
	});

	it("opens the system sound settings from the headphones button", async () => {
		setInvokeHandler("open_sound_settings", () => undefined);
		render(<MusicCardView media={playingMedia()} />);

		await userEvent.click(screen.getByRole("button", { name: "Audio output" }));

		expect(callsTo("open_sound_settings")).toHaveLength(1);
	});
});
