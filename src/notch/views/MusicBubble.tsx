import type { Dispatch, RefObject, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Music } from "../../icons/glyphs";
import type { MediaInfo, NotchPanel } from "../types";

export interface MusicBubbleProps {
	/** Whether the bubble is drawn: music is playing while a timer holds the collapsed pill. */
	showMusicBubble: boolean;
	mediaInfo: MediaInfo;
	albumArtUrl: string | null;
	settingsAlbumArtEnabled: boolean;
	musicBubbleRef: RefObject<HTMLButtonElement | null>;
	isHovered: boolean;
	setIsHovered: Dispatch<SetStateAction<boolean>>;
	/** Re-measures the notch's click-through region after the bubble animates away. */
	reportNotchRect: RefObject<() => void>;
	openNotch: (view: NotchPanel | "music" | "shelf") => void;
	/** Width of the collapsed pill; the bubble sits beside it. */
	getDynamicWidth: () => number;
}

/** Music in its own bubble beside the pill while a running timer holds the pill itself. */
export function MusicBubble({
	showMusicBubble,
	mediaInfo,
	albumArtUrl,
	settingsAlbumArtEnabled,
	musicBubbleRef,
	isHovered,
	setIsHovered,
	reportNotchRect,
	openNotch,
	getDynamicWidth
}: MusicBubbleProps) {
	return (
		<AnimatePresence onExitComplete={() => reportNotchRect.current()}>
			{showMusicBubble && (
				<motion.button
					key="music-bubble"
					ref={musicBubbleRef}
					type="button"
					className={`activity-bubble ${isHovered ? "expanded" : ""}`}
					aria-label={mediaInfo.title ? `Open music: ${mediaInfo.title}` : "Open music"}
					// Anchored at the pill's centre, offset past its right edge.
					style={{ left: "50%" }}
					initial={{ opacity: 0, scale: 0.4, x: -28, marginLeft: getDynamicWidth() / 2 + 8 }}
					animate={{ opacity: 1, scale: 1, x: 0, marginLeft: getDynamicWidth() / 2 + 8 }}
					exit={{ opacity: 0, scale: 0.4, x: -28 }}
					transition={{
						type: "spring",
						stiffness: 400,
						damping: 31,
						opacity: { duration: 0.15 }
					}}
					onAnimationComplete={() => reportNotchRect.current()}
					onClick={(e) => {
						e.stopPropagation();
						setIsHovered(true);
						openNotch("music");
					}}
				>
					{settingsAlbumArtEnabled && albumArtUrl ? (
						<img src={albumArtUrl} alt="" draggable={false} />
					) : (
						<Music size={14} strokeWidth={2.2} />
					)}
				</motion.button>
			)}
		</AnimatePresence>
	);
}
