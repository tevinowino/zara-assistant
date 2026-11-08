import type { Dispatch, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { CompactMediaPlayer } from "../../CompactMediaPlayer";
import {
	HeadphonesIcon,
	MusicNoteIcon,
	PauseIcon,
	PlayIcon,
	SkipBackIcon,
	SkipForwardIcon,
	VolumeHighIcon,
	VolumeLowIcon
} from "../../icons";
import { TitleMarquee } from "../components/TitleMarquee";
import { Visualizer } from "../components/Visualizer";
import type { useMediaPlayback } from "../hooks/useMediaPlayback";
import type { MediaLayout } from "../music/mediaLayouts";
import { MusicCardView } from "./MusicCardView";

export interface MusicPlayerViewProps {
	/** The now-playing state and controls from the media hook. */
	media: ReturnType<typeof useMediaPlayback>;
	/** Which player layout the user chose in Settings. */
	mediaLayout: MediaLayout;
	setMediaLayout: Dispatch<SetStateAction<MediaLayout>>;
	/** Whether the compact layout's volume slider is expanded. */
	compactVolumeExpanded: boolean;
	setCompactVolumeExpanded: Dispatch<SetStateAction<boolean>>;
}

/** The notch opened on music: album art, title and artist, transport controls, volume and progress. */
export function MusicPlayerView({
	media,
	mediaLayout,
	setMediaLayout,
	compactVolumeExpanded,
	setCompactVolumeExpanded
}: MusicPlayerViewProps) {
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
	return (
		<motion.div
			key="expanded-music"
			className="expanded-music-container"
			initial={{ opacity: 0, scale: 0.98 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
			transition={{ type: "spring", stiffness: 500, damping: 30 }}
		>
			{mediaLayout === "card" ? (
				<MusicCardView media={media} />
			) : mediaLayout === "compact" ? (
				<CompactMediaPlayer
					mediaInfo={mediaInfo}
					albumArtUrl={albumArtUrl}
					albumArtKey={albumArtKey}
					isPlaying={isPlaying}
					volume={displayVolume}
					volumeExpanded={compactVolumeExpanded}
					onVolumeExpandedChange={setCompactVolumeExpanded}
					onTogglePlayPause={togglePlayPause}
					onVolumeChange={handleVolumeChange}
					prevFront={prevFront}
					prevBack={prevBack}
					nextFront={nextFront}
					nextBack={nextBack}
					onAnimatePrev={animatePrev}
					onAnimateNext={animateNext}
					onLayoutChange={(layout) => {
						setMediaLayout(layout);
						localStorage.setItem("zara-media-layout", layout);
						invoke("save_setting", {
							key: "zara-media-layout",
							value: layout
						}).catch(console.error);
						window.dispatchEvent(
							new CustomEvent("settings-changed", {
								detail: { key: "media-layout", value: layout }
							})
						);
					}}
				/>
			) : (
				<div className="compact-premium-layout">
					<div className="album-art-section">
						<motion.div
							className="premium-album-art"
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							onClick={(e) => {
								e.stopPropagation();
								setMediaLayout("compact");
								localStorage.setItem("zara-media-layout", "compact");
								invoke("save_setting", {
									key: "zara-media-layout",
									value: "compact"
								}).catch(console.error);
								window.dispatchEvent(
									new CustomEvent("settings-changed", {
										detail: { key: "media-layout", value: "compact" }
									})
								);
							}}
							style={{ cursor: "pointer" }}
						>
							<AnimatePresence mode="wait" initial={false}>
								{albumArtUrl ? (
									<motion.img
										key={`art-${albumArtKey}`}
										src={albumArtUrl}
										alt="Art"
										initial={{ rotateY: 90, opacity: 0 }}
										animate={{ rotateY: 0, opacity: 1 }}
										exit={{ rotateY: -90, opacity: 0 }}
										transition={{ duration: 0.3, ease: "easeInOut" }}
										style={{ width: "100%", height: "100%", objectFit: "cover" }}
									/>
								) : (
									<motion.div
										key="placeholder"
										className="art-placeholder-mini"
										initial={{ rotateY: 90, opacity: 0 }}
										animate={{ rotateY: 0, opacity: 1 }}
										exit={{ rotateY: -90, opacity: 0 }}
										transition={{ duration: 0.3, ease: "easeInOut" }}
									>
										<MusicNoteIcon size={32} className="music-placeholder-svg" />
									</motion.div>
								)}
							</AnimatePresence>
						</motion.div>
					</div>

					<div className="metadata-controls-section-middle">
						<div className="track-header-row">
							<div className="track-info-middle">
								<TitleMarquee title={mediaInfo.title} />
								<span className="premium-artist">{mediaInfo.artist}</span>
							</div>
							<div className="header-visualizer-wrap">
								<div className="header-visualizer">
									<Visualizer isPlaying={isPlaying} bars={5} height={18} />
								</div>
								<motion.button
									className="classic-audio-output-btn"
									onClick={(e) => {
										e.stopPropagation();
										invoke("open_sound_settings").catch(() => {});
									}}
									whileTap={{ scale: 0.9 }}
									title="Audio Output"
								>
									<HeadphonesIcon size={20} style={{ opacity: 0.5 }} />
								</motion.button>
							</div>
						</div>

						<div className="controls-row-sleek">
							<motion.button
								className="sleek-btn previous-btn"
								onClick={(e) => {
									e.stopPropagation();
									animatePrev();
								}}
								whileHover={{ scale: 1.2 }}
								whileTap={{ scale: 0.9 }}
								transition={{ type: "spring", stiffness: 400, damping: 25 }}
							>
								<div
									style={{
										position: "relative",
										width: 32,
										height: 16,
										overflow: "hidden"
									}}
								>
									<motion.div
										animate={prevBack}
										style={{
											position: "absolute",
											inset: 0,
											display: "flex",
											alignItems: "center",
											justifyContent: "center"
										}}
									>
										<SkipBackIcon size={32} />
									</motion.div>
									<motion.div
										animate={prevFront}
										style={{
											position: "absolute",
											inset: 0,
											display: "flex",
											alignItems: "center",
											justifyContent: "center"
										}}
									>
										<SkipBackIcon size={32} />
									</motion.div>
								</div>
							</motion.button>

							<motion.button
								className="sleek-btn play-pause-btn-floating"
								onClick={(e) => {
									e.stopPropagation();
									togglePlayPause();
								}}
								whileHover={{ scale: 1.2 }}
								whileTap={{ scale: 0.95 }}
								transition={{ type: "spring", stiffness: 400, damping: 25 }}
							>
								<AnimatePresence mode="wait" initial={false}>
									<motion.div
										key={isPlaying ? "pause" : "play"}
										initial={{ opacity: 0, scale: 0.8 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={{ opacity: 0, scale: 0.8 }}
										transition={{ duration: 0.15 }}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center"
										}}
									>
										{isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
									</motion.div>
								</AnimatePresence>
							</motion.button>

							<motion.button
								className="sleek-btn next-btn"
								onClick={(e) => {
									e.stopPropagation();
									animateNext();
								}}
								whileHover={{ scale: 1.2 }}
								whileTap={{ scale: 0.9 }}
								transition={{ type: "spring", stiffness: 400, damping: 25 }}
							>
								<div
									style={{
										position: "relative",
										width: 32,
										height: 16,
										overflow: "hidden"
									}}
								>
									<motion.div
										animate={nextBack}
										style={{
											position: "absolute",
											inset: 0,
											display: "flex",
											alignItems: "center",
											justifyContent: "center"
										}}
									>
										<SkipForwardIcon size={32} />
									</motion.div>
									<motion.div
										animate={nextFront}
										style={{
											position: "absolute",
											inset: 0,
											display: "flex",
											alignItems: "center",
											justifyContent: "center"
										}}
									>
										<SkipForwardIcon size={32} />
									</motion.div>
								</div>
							</motion.button>
						</div>

						<div className="volume-slider-container">
							<VolumeLowIcon size={12} style={{ opacity: 0.5 }} />
							<div className="slider-track-premium">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={displayVolume}
									onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={(e) => e.stopPropagation()}
									className="premium-slider"
								/>
								<div
									className="slider-progress-fill"
									style={{ width: `${displayVolume * 100}%` }}
								/>
							</div>
							<VolumeHighIcon size={14} style={{ opacity: 0.5 }} />
						</div>
					</div>
				</div>
			)}
		</motion.div>
	);
}
