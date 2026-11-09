import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "../../icons/glyphs";
import { lyricsStore } from "../lyrics/lyricsStore";
import type { LyricsState } from "../lyrics/lyricsTypes";

/** How many lines show on each side of the line being sung. */
const LINES_AROUND = 2;

export interface CardLyricsProps {
	state: LyricsState;
	/** The index of the line being sung; -1 before the first line starts. */
	activeIndex: number;
}

/**
 * The lyrics laid over the music card's cover: the line being sung, large and white, with the
 * lines before and after it fading away. A frosted scrim keeps them readable on any cover.
 */
export function CardLyrics({ state, activeIndex }: CardLyricsProps) {
	return (
		<motion.div
			className="mcard-lyrics"
			role="region"
			aria-label="Lyrics"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.25 }}
		>
			<div className="mcard-lyrics-body">
				<CardLyricsContent state={state} activeIndex={activeIndex} />
			</div>
		</motion.div>
	);
}

function Message({ children }: { children: string }) {
	return <p className="mcard-lyrics-message">{children}</p>;
}

function CardLyricsContent({ state, activeIndex }: CardLyricsProps) {
	switch (state.status) {
		case "idle":
			return <Message>Play something to see its lyrics.</Message>;
		case "loading":
			return <Message>Looking for the lyrics…</Message>;
		case "none":
			return <Message>No lyrics found for this song.</Message>;
		case "instrumental":
			return <Message>No words in this one. Just listen.</Message>;
		case "error":
			return (
				<div className="mcard-lyrics-message">
					<p>The lyrics could not be loaded.</p>
					<button type="button" className="mcard-lyrics-retry" onClick={() => lyricsStore.retry()}>
						<RefreshCw size={12} strokeWidth={2.2} /> Try again
					</button>
				</div>
			);
		case "plain":
			return (
				<div className="mcard-lyrics-plain" tabIndex={0}>
					{state.text}
				</div>
			);
		case "synced": {
			// Before the first line starts, the first lines wait below the middle.
			const center = Math.max(activeIndex, 0);
			const first = Math.max(0, center - LINES_AROUND);
			const visible = state.lines.slice(first, center + LINES_AROUND + 1);
			return (
				<ol className="mcard-lyrics-lines">
					<AnimatePresence initial={false} mode="popLayout">
						{visible.map((line, offset) => {
							const index = first + offset;
							const distance = Math.abs(index - activeIndex);
							const isActive = index === activeIndex;
							return (
								<motion.li
									key={`${line.timeMs}-${index}`}
									className={`mcard-lyrics-line${isActive ? " active" : ""}`}
									data-distance={Math.min(distance, LINES_AROUND + 1)}
									aria-current={isActive ? "true" : undefined}
									layout
									initial={{ opacity: 0, y: 8 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -8 }}
									transition={{ duration: 0.25 }}
								>
									{line.text.trim() === "" ? "♪" : line.text}
								</motion.li>
							);
						})}
					</AnimatePresence>
				</ol>
			);
		}
	}
}
