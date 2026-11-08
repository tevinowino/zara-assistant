import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlaybackClock } from "../playback/usePlaybackClock";
import type { useMediaPlayback } from "../hooks/useMediaPlayback";
import { MusicCard } from "./MusicCard";

export interface MusicCardViewProps {
	/** The now-playing state and controls from the media hook. */
	media: ReturnType<typeof useMediaPlayback>;
}

/** The notch opened on music, as the card layout: the cover with the controls on it. */
export function MusicCardView({ media }: MusicCardViewProps) {
	const {
		isPlaying,
		mediaInfo,
		albumArtUrl,
		albumArtKey,
		displayVolume,
		togglePlayPause,
		prevFront,
		prevBack,
		nextFront,
		nextBack,
		animatePrev,
		animateNext,
		handleVolumeChange
	} = media;

	const durationMs = mediaInfo.duration_ms ?? 0;
	const clock = usePlaybackClock({
		positionMs: mediaInfo.position_ms ?? 0,
		positionUpdatedAt: mediaInfo.position_updated_at ?? 0,
		durationMs,
		isPlaying
	});

	const finishSeek = useCallback(() => {
		invoke("media_seek", { positionMs: clock.commitSeek() }).catch(() => {});
	}, [clock]);

	return (
		<MusicCard
			title={mediaInfo.title}
			artist={mediaInfo.artist}
			artUrl={albumArtUrl}
			artKey={albumArtKey}
			isPlaying={isPlaying}
			positionMs={clock.positionMs}
			durationMs={durationMs}
			seekEnabled={mediaInfo.seek_enabled ?? false}
			onSeekStart={clock.beginSeek}
			onSeekChange={clock.previewSeek}
			onSeekEnd={finishSeek}
			volume={displayVolume}
			onVolumeChange={handleVolumeChange}
			onTogglePlayPause={togglePlayPause}
			onPrevious={animatePrev}
			onNext={animateNext}
			previousAnimation={{ front: prevFront, back: prevBack }}
			nextAnimation={{ front: nextFront, back: nextBack }}
			onOpenAudioOutput={() => {
				invoke("open_sound_settings").catch(() => {});
			}}
		/>
	);
}
