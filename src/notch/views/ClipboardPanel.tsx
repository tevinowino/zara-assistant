import { useEffect, useRef, useState } from "react";
import { Check, X } from "../../icons/glyphs";
import { describeNoteAge } from "../notes/noteAge";
import { useClipboardHistory, type ClipboardEntry } from "../clipboard/useClipboardHistory";
import type { ZaraMode } from "../types";
import { WidgetPanelShell } from "../widgets/WidgetPanelShell";

/** Size of the notch while it shows the clipboard history, including its 36px top row. */
export const CLIPBOARD_PANEL_WIDTH_PX = 380;
export const CLIPBOARD_PANEL_HEIGHT_PX = 300;

/** How long "Copied" stays on an entry, in milliseconds. */
const COPIED_SHOWN_MS = 1400;

export interface ClipboardPanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "clipboard". */
	zaraMode: ZaraMode;
}

/** The clipboard widget: what was copied lately, one click to copy it again. */
export function ClipboardPanel({ zaraMode }: ClipboardPanelProps) {
	return (
		<WidgetPanelShell panel="clipboard" zaraMode={zaraMode} className="clipboard-panel" ownsScroll>
			<ClipboardContent />
		</WidgetPanelShell>
	);
}

function ClipboardContent() {
	const { entries, failed, copyAgain, remove, clearAll } = useClipboardHistory();
	const [copiedId, setCopiedId] = useState<number | null>(null);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const now = Date.now();

	useEffect(
		() => () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		},
		[]
	);

	const copy = async (entry: ClipboardEntry) => {
		if (!(await copyAgain(entry))) return;
		setCopiedId(entry.id);
		if (copiedTimer.current) clearTimeout(copiedTimer.current);
		copiedTimer.current = setTimeout(() => setCopiedId(null), COPIED_SHOWN_MS);
	};

	return (
		<>
			<header className="clipboard-header">
				<h2>Clipboard</h2>
				{entries !== null && entries.length > 0 && (
					<button type="button" className="clipboard-clear" onClick={() => void clearAll()}>
						Clear all
					</button>
				)}
			</header>

			{failed && <p className="clipboard-message">The clipboard history could not be loaded.</p>}
			{!failed && entries !== null && entries.length === 0 && (
				<p className="clipboard-message">Copy something and it will show up here.</p>
			)}

			{entries !== null && entries.length > 0 && (
				<ul className="clipboard-list" aria-label="Copied items">
					{entries.map((entry) => (
						<li key={entry.id} className="clipboard-item">
							<button
								type="button"
								className="clipboard-body"
								onClick={() => void copy(entry)}
								title="Click to copy again"
							>
								<span className="clipboard-text">{entry.text}</span>
								<span className="clipboard-meta">
									{copiedId === entry.id ? (
										<span className="clipboard-copied" role="status">
											<Check size={11} strokeWidth={2.6} /> Copied
										</span>
									) : (
										describeNoteAge(entry.copiedAt, now)
									)}
								</span>
							</button>
							<button
								type="button"
								className="clipboard-delete"
								aria-label={`Remove from history: ${entry.text.slice(0, 40)}`}
								onClick={() => void remove(entry.id)}
							>
								<X size={13} strokeWidth={2.4} />
							</button>
						</li>
					))}
				</ul>
			)}

			<p className="clipboard-note">
				Text only, kept in memory until Zara quits. Copies from password managers are skipped.
			</p>
		</>
	);
}
