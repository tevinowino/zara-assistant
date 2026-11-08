import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MusicCard, type MusicCardProps } from "./MusicCard";

/** A card showing "Notice me" by Migos at 0:52 of 2:13, playing, with a cover. */
function renderCard(overrides: Partial<MusicCardProps> = {}) {
	const props: MusicCardProps = {
		title: "Notice me",
		artist: "Migos",
		artUrl: "data:image/png;base64,cover",
		artKey: 1,
		isPlaying: true,
		positionMs: 52_000,
		durationMs: 133_000,
		seekEnabled: true,
		onSeekStart: vi.fn(),
		onSeekChange: vi.fn(),
		onSeekEnd: vi.fn(),
		volume: 0.4,
		onVolumeChange: vi.fn(),
		onTogglePlayPause: vi.fn(),
		onPrevious: vi.fn(),
		onNext: vi.fn(),
		onOpenAudioOutput: vi.fn(),
		...overrides
	};
	return { props, ...render(<MusicCard {...props} />) };
}

describe("MusicCard", () => {
	it("shows the artist and the title of the track", () => {
		renderCard({ title: "Notice me", artist: "Migos" });

		expect(screen.getByText("Migos")).toBeInTheDocument();
		expect(screen.getByText("Notice me")).toBeInTheDocument();
	});

	it("shows how far into the track it is and how much is left", () => {
		renderCard({ positionMs: 52_000, durationMs: 133_000 });

		expect(screen.getByText("0:52")).toBeInTheDocument();
		expect(screen.getByText("-1:21")).toBeInTheDocument();
	});

	it("shows no progress bar when the player does not say how long the track is", () => {
		renderCard({ durationMs: 0 });

		expect(screen.queryByRole("slider", { name: "Seek" })).not.toBeInTheDocument();
		expect(screen.queryByText("0:52")).not.toBeInTheDocument();
	});

	it("lets the user seek when the player allows it", () => {
		const { props } = renderCard({ seekEnabled: true });

		fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "90000" } });

		expect(props.onSeekChange).toHaveBeenCalledWith(90_000);
	});

	it("does not offer seeking when the player does not allow it", () => {
		renderCard({ seekEnabled: false });

		expect(screen.queryByRole("slider", { name: "Seek" })).not.toBeInTheDocument();
		expect(screen.getByText("0:52")).toBeInTheDocument();
	});

	it("tells the notch when the user lets go of the seek bar", () => {
		const { props } = renderCard();
		const seekBar = screen.getByRole("slider", { name: "Seek" });

		fireEvent.mouseDown(seekBar);
		fireEvent.mouseUp(seekBar);

		expect(props.onSeekStart).toHaveBeenCalledTimes(1);
		expect(props.onSeekEnd).toHaveBeenCalledTimes(1);
	});

	it("offers to pause while the track plays", async () => {
		const { props } = renderCard({ isPlaying: true });

		await userEvent.click(screen.getByRole("button", { name: "Pause" }));

		expect(props.onTogglePlayPause).toHaveBeenCalledTimes(1);
	});

	it("offers to play while the track is paused", () => {
		renderCard({ isPlaying: false });

		expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
	});

	it("goes to the previous and the next track", async () => {
		const { props } = renderCard();

		await userEvent.click(screen.getByRole("button", { name: "Previous track" }));
		await userEvent.click(screen.getByRole("button", { name: "Next track" }));

		expect(props.onPrevious).toHaveBeenCalledTimes(1);
		expect(props.onNext).toHaveBeenCalledTimes(1);
	});

	it("opens the audio output settings", async () => {
		const { props } = renderCard();

		await userEvent.click(screen.getByRole("button", { name: "Audio output" }));

		expect(props.onOpenAudioOutput).toHaveBeenCalledTimes(1);
	});

	it("changes the volume from the slider", () => {
		const { props } = renderCard({ volume: 0.4 });

		fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.75" } });

		expect(props.onVolumeChange).toHaveBeenCalledWith(0.75);
	});

	it("keeps a click on a button from reaching the notch, which would close it", async () => {
		const onNotchClick = vi.fn();
		const props: MusicCardProps = {
			title: "Notice me",
			artist: "Migos",
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
		render(
			<div onClick={onNotchClick}>
				<MusicCard {...props} />
			</div>
		);

		await userEvent.click(screen.getByRole("button", { name: "Next track" }));

		expect(onNotchClick).not.toHaveBeenCalled();
	});

	it("fills the card with the cover", () => {
		const { container } = renderCard({ artUrl: "data:image/png;base64,cover" });

		expect(container.querySelector("img.mcard-art")).toHaveAttribute(
			"src",
			"data:image/png;base64,cover"
		);
	});

	it("shows a placeholder when there is no cover", () => {
		const { container } = renderCard({ artUrl: null });

		expect(container.querySelector("img")).not.toBeInTheDocument();
		expect(container.querySelector(".mcard-art-placeholder")).toBeInTheDocument();
	});
});
