import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus, RefreshCw, Sparkles, StickyNote } from "../../icons/glyphs";
import { noteAdd } from "../../ai/api";
import { lineToHighlight, LYRICS_OFFSET_STEP_MS } from "../lyrics/activeLine";
import { lyricsStore, useLyricsState } from "../lyrics/lyricsStore";
import { useLyricsOffset } from "../lyrics/useLyricsOffset";
import { usePlaybackClock } from "../playback/usePlaybackClock";
import type { ZaraMode } from "../types";
import type { MediaSnapshot } from "../lyrics/lyricsTypes";
import { WidgetPanelShell } from "../widgets/WidgetPanelShell";
import "./LyricsPanel.css";

/** Size of the notch while it shows the lyrics, including its 36px top row. */
export const LYRICS_PANEL_WIDTH_PX = 380;
export const LYRICS_PANEL_HEIGHT_PX = 340;

/** How long "Saved" stays on the button after a line is saved, in milliseconds. */
const SAVED_SHOWN_MS = 1400;

export interface LyricsPanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "lyrics". */
	zaraMode: ZaraMode;
	/** What is playing. */
	media: MediaSnapshot;
	/** Sends a question to the assistant and opens it. */
	askZara: (question: string) => void;
}

/**
 * The lyrics widget: the song that is playing, line by line, with the line being sung
 * highlighted. Click a line to save it to the notes or ask the assistant about it.
 */
export function LyricsPanel({ zaraMode, media, askZara }: LyricsPanelProps) {
	return (
		<WidgetPanelShell panel="lyrics" zaraMode={zaraMode} className="lyrics-panel" ownsScroll>
			<LyricsContent media={media} askZara={askZara} />
		</WidgetPanelShell>
	);
}

function LyricsContent({ media, askZara }: Pick<LyricsPanelProps, "media" | "askZara">) {
	const { mediaInfo, isPlaying } = media;
	const lyrics = useLyricsState();
	const clock = usePlaybackClock({
		positionMs: mediaInfo.position_ms ?? 0,
		positionUpdatedAt: mediaInfo.position_updated_at ?? 0,
		durationMs: mediaInfo.duration_ms ?? 0,
		isPlaying
	});
	const { offsetMs, nudge, reset } = useLyricsOffset();
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [saved, setSaved] = useState(false);
	const activeRef = useRef<HTMLLIElement | null>(null);

	const lines = lyrics.status === "synced" ? lyrics.lines : [];
	const activeIndex = lineToHighlight(lines, clock.positionMs, offsetMs);

	// A new track starts with nothing selected.
	const trackKey = lyrics.status === "idle" ? null : lyrics.trackKey;
	useEffect(() => {
		setSelectedIndex(null);
		setSaved(false);
	}, [trackKey]);

	// The line being sung stays in view.
	useEffect(() => {
		activeRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
	}, [activeIndex]);

	const selectedText = selectedIndex !== null ? (lines[selectedIndex]?.text ?? "") : "";
	const songName = [mediaInfo.artist, mediaInfo.title].filter(Boolean).join(" — ");

	const saveSelectedLine = async () => {
		if (selectedText.trim() === "") return;
		try {
			const note = await noteAdd(selectedText, songName || undefined);
			if (note === null) return;
			setSaved(true);
			window.setTimeout(() => setSaved(false), SAVED_SHOWN_MS);
		} catch {
			// Nothing was saved; the button stays as it was.
		}
	};

	const askAboutSelectedLine = () => {
		if (selectedText.trim() === "") return;
		askZara(`What does this lyric mean? “${selectedText}” — ${songName}`);
	};

	return (
		<>
			<header className="lyrics-header">
				<span className="lyrics-song" title={songName}>
					{songName || "Lyrics"}
				</span>
				{lyrics.status === "synced" && (
					<span className="lyrics-sync" role="group" aria-label="Lyrics timing">
						<button
							type="button"
							aria-label="Show lyrics later"
							title={`Show lyrics ${LYRICS_OFFSET_STEP_MS} ms later`}
							onClick={() => nudge("later")}
						>
							<Minus size={12} strokeWidth={2.4} />
						</button>
						<button
							type="button"
							className="lyrics-sync-value"
							aria-label="Reset lyrics timing"
							title="Reset timing"
							onClick={reset}
						>
							{(offsetMs / 1000).toFixed(2)}s
						</button>
						<button
							type="button"
							aria-label="Show lyrics sooner"
							title={`Show lyrics ${LYRICS_OFFSET_STEP_MS} ms sooner`}
							onClick={() => nudge("sooner")}
						>
							<Plus size={12} strokeWidth={2.4} />
						</button>
					</span>
				)}
			</header>

			{lyrics.status === "idle" && (
				<p className="lyrics-message">Play something to see its lyrics.</p>
			)}
			{lyrics.status === "loading" && <p className="lyrics-message">Looking for the lyrics…</p>}
			{lyrics.status === "none" && <p className="lyrics-message">No lyrics found for this song.</p>}
			{lyrics.status === "instrumental" && (
				<p className="lyrics-message">This one has no words. Just listen.</p>
			)}
			{lyrics.status === "error" && (
				<div className="lyrics-message">
					<p>The lyrics could not be loaded.</p>
					<button type="button" className="lyrics-retry" onClick={() => lyricsStore.retry()}>
						<RefreshCw size={12} strokeWidth={2.2} /> Try again
					</button>
				</div>
			)}
			{lyrics.status === "plain" && (
				<div className="lyrics-plain" tabIndex={0} aria-label="Lyrics">
					{lyrics.text}
				</div>
			)}
			{lyrics.status === "synced" && (
				<ol className="lyrics-lines" aria-label="Lyrics">
					{lyrics.lines.map((line, index) => (
						<li
							key={`${line.timeMs}-${index}`}
							ref={index === activeIndex ? activeRef : undefined}
							className={`lyrics-line${index === activeIndex ? " active" : ""}${
								index === selectedIndex ? " selected" : ""
							}`}
							aria-current={index === activeIndex ? "true" : undefined}
						>
							{line.text.trim() === "" ? (
								<span className="lyrics-break" aria-hidden="true">
									♪
								</span>
							) : (
								<button
									type="button"
									onClick={() => setSelectedIndex(index === selectedIndex ? null : index)}
								>
									{line.text}
								</button>
							)}
						</li>
					))}
				</ol>
			)}

			{selectedIndex !== null && selectedText.trim() !== "" && (
				<div className="lyrics-actions">
					<button type="button" onClick={() => void saveSelectedLine()} disabled={saved}>
						{saved ? <Check size={13} strokeWidth={2.4} /> : <StickyNote size={13} />}
						{saved ? "Saved" : "Save to Notes"}
					</button>
					<button type="button" onClick={askAboutSelectedLine}>
						<Sparkles size={13} /> Ask Zara
					</button>
				</div>
			)}
		</>
	);
}
