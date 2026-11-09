import type { ReactNode } from "react";
import { AnimatePresence, motion, type useAnimation } from "framer-motion";
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
import { Microphone } from "../../icons/glyphs";
import type { LyricsState } from "../lyrics/lyricsTypes";
import { formatPlaybackTime, formatTimeRemaining } from "../playback/playbackClock";
import { TitleMarquee } from "../components/TitleMarquee";
import { CardLyrics } from "./CardLyrics";
import "./MusicCard.css";

/**
 * The heights (as a share of the top band) of the strips that blur the cover behind the
 * artist and title. They stack, so the blur is strongest at the top and fades in small steps
 * that the dark fade hides; a single strip would leave a visible edge.
 */
const BLUR_STRIP_HEIGHTS_PERCENT = [100, 84, 68, 52, 36, 22];

/** The two layers a skip icon slides between (see `useMediaPlayback`). */
export interface SkipAnimation {
	front: ReturnType<typeof useAnimation>;
	back: ReturnType<typeof useAnimation>;
}

/** The card's lyrics button and what it shows when pressed. */
export interface MusicCardLyrics {
	/** The lyrics are laid over the cover. */
	shown: boolean;
	/** The lyrics button was pressed. */
	onToggle: () => void;
	state: LyricsState;
	/** The index of the line being sung; -1 before the first line starts. */
	activeIndex: number;
}

export interface MusicCardProps {
	title: string;
	artist: string;
	/** The cover, filling the card; null shows a placeholder. */
	artUrl: string | null;
	/** Changes with each cover, so the new one fades in over the old. */
	artKey: number;
	isPlaying: boolean;
	/** The playhead, in milliseconds. */
	positionMs: number;
	/** The track's length in milliseconds, or 0 when the player does not say. */
	durationMs: number;
	/** The player lets the user seek. */
	seekEnabled: boolean;
	onSeekStart: () => void;
	onSeekChange: (positionMs: number) => void;
	onSeekEnd: () => void;
	/** The system volume, 0-1. */
	volume: number;
	onVolumeChange: (volume: number) => void;
	onTogglePlayPause: () => void;
	onPrevious: () => void;
	onNext: () => void;
	/** Slides the skip icons when pressed; without it the icons stay still. */
	previousAnimation?: SkipAnimation;
	nextAnimation?: SkipAnimation;
	/** Opens the system's sound output settings. */
	onOpenAudioOutput: () => void;
	/** Without it the card has no lyrics button. */
	lyrics?: MusicCardLyrics;
}

/**
 * The music card: the album cover fills the card, the artist and title sit on a blurred band
 * across the top, and the controls (progress, previous / play / next, volume) float on the
 * cover as frosted-glass buttons. It shows what it is given and holds no state of its own,
 * so the notch and the Settings preview draw the same card.
 */
export function MusicCard({
	title,
	artist,
	artUrl,
	artKey,
	isPlaying,
	positionMs,
	durationMs,
	seekEnabled,
	onSeekStart,
	onSeekChange,
	onSeekEnd,
	volume,
	onVolumeChange,
	onTogglePlayPause,
	onPrevious,
	onNext,
	previousAnimation,
	nextAnimation,
	onOpenAudioOutput,
	lyrics
}: MusicCardProps) {
	const progressPercent = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;

	return (
		<div className="mcard">
			<AnimatePresence initial={false}>
				{artUrl ? (
					<motion.img
						key={`art-${artKey}`}
						className="mcard-art"
						src={artUrl}
						alt=""
						draggable={false}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.4 }}
					/>
				) : (
					<motion.div
						key="placeholder"
						className="mcard-art mcard-art-placeholder"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
					>
						<MusicNoteIcon size={56} />
					</motion.div>
				)}
			</AnimatePresence>

			<AnimatePresence>
				{lyrics?.shown && (
					<CardLyrics key="lyrics" state={lyrics.state} activeIndex={lyrics.activeIndex} />
				)}
			</AnimatePresence>

			<div className="mcard-top">
				{BLUR_STRIP_HEIGHTS_PERCENT.map((height) => (
					<span key={height} className="mcard-blur" style={{ height: `${height}%` }} />
				))}
				<div className="mcard-heading">
					<span className="mcard-artist">{artist}</span>
					<TitleMarquee title={title} />
				</div>
			</div>

			<div className="mcard-bottom">
				{durationMs > 0 && (
					<div className="mcard-progress">
						<span className="mcard-time">{formatPlaybackTime(positionMs)}</span>
						<div className="cmp-track-bar mcard-bar">
							<div className="cmp-track-fill" style={{ width: `${progressPercent}%` }} />
							{seekEnabled && (
								<input
									type="range"
									className="cmp-seek"
									aria-label="Seek"
									min={0}
									max={durationMs}
									step={100}
									value={positionMs}
									onMouseDown={onSeekStart}
									onTouchStart={onSeekStart}
									onChange={(event) => onSeekChange(Number(event.target.value))}
									onMouseUp={onSeekEnd}
									onTouchEnd={onSeekEnd}
									onClick={(event) => event.stopPropagation()}
								/>
							)}
						</div>
						<span className="mcard-time">{formatTimeRemaining(positionMs, durationMs)}</span>
					</div>
				)}

				<div className="mcard-transport">
					<div className="mcard-transport-side">
						<GlassButton label="Audio output" onClick={onOpenAudioOutput} small>
							<HeadphonesIcon size={18} />
						</GlassButton>
					</div>
					<div className="mcard-transport-main">
						<GlassButton label="Previous track" onClick={onPrevious}>
							<SlidingIcon animation={previousAnimation}>
								<SkipBackIcon size={26} />
							</SlidingIcon>
						</GlassButton>
						<GlassButton label={isPlaying ? "Pause" : "Play"} onClick={onTogglePlayPause} large>
							<AnimatePresence mode="wait" initial={false}>
								<motion.span
									key={isPlaying ? "pause" : "play"}
									className="mcard-play-icon"
									initial={{ opacity: 0, scale: 0.7 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.7 }}
									transition={{ duration: 0.12 }}
								>
									{isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
								</motion.span>
							</AnimatePresence>
						</GlassButton>
						<GlassButton label="Next track" onClick={onNext}>
							<SlidingIcon animation={nextAnimation}>
								<SkipForwardIcon size={26} />
							</SlidingIcon>
						</GlassButton>
					</div>
					<div className="mcard-transport-side mcard-transport-side-end">
						{lyrics && (
							<GlassButton label="Lyrics" onClick={lyrics.onToggle} pressed={lyrics.shown} small>
								<Microphone size={18} />
							</GlassButton>
						)}
					</div>
				</div>

				<div className="cmp-volume-row mcard-volume">
					<VolumeLowIcon size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
					<div className="cmp-volume-track">
						<div className="cmp-volume-fill" style={{ width: `${volume * 100}%` }} />
						<input
							type="range"
							className="cmp-volume-slider"
							aria-label="Volume"
							min={0}
							max={1}
							step={0.01}
							value={volume}
							onChange={(event) => onVolumeChange(Number(event.target.value))}
							onClick={(event) => event.stopPropagation()}
						/>
					</div>
					<VolumeHighIcon size={15} style={{ opacity: 0.7, flexShrink: 0 }} />
				</div>
			</div>
		</div>
	);
}

interface GlassButtonProps {
	label: string;
	onClick: () => void;
	/** A button that stays on: whether it is on. */
	pressed?: boolean;
	large?: boolean;
	small?: boolean;
	children: ReactNode;
}

/** A round frosted-glass button over the cover. */
function GlassButton({
	label,
	onClick,
	pressed,
	large = false,
	small = false,
	children
}: GlassButtonProps) {
	return (
		<motion.button
			type="button"
			className={`mcard-button${large ? " mcard-button-large" : ""}${small ? " mcard-button-small" : ""}`}
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			whileTap={{ scale: 0.92 }}
		>
			{children}
		</motion.button>
	);
}

/** An icon that slides out and back in when its button is pressed, if given the animation. */
function SlidingIcon({ animation, children }: { animation?: SkipAnimation; children: ReactNode }) {
	if (!animation) return <>{children}</>;
	return (
		<span className="cmp-slide-wrap">
			<motion.span animate={animation.back} className="cmp-slide-layer">
				{children}
			</motion.span>
			<motion.span animate={animation.front} className="cmp-slide-layer">
				{children}
			</motion.span>
		</span>
	);
}
