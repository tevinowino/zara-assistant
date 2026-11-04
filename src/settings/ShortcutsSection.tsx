import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, RotateCcw } from "../icons/glyphs";
import { shortcutList, shortcutReset, shortcutSet, toAiError, type ShortcutRow } from "../ai/api";
import { acceleratorParts, keyboardEventToAccelerator } from "../ai/lib/accelerator";
import { SettingRow } from "./SettingRow";

const SCOPE_NOTE = {
	global: "Works in any app",
	panel: "Works while the Zara panel is open"
} as const;

function KeyCaps({ accelerator }: { accelerator: string }) {
	return (
		<span className="shortcut-caps">
			{acceleratorParts(accelerator).map((part, index) => (
				<kbd key={index}>{part}</kbd>
			))}
		</span>
	);
}

// The user records any combination they like. If it cannot be used, the backend
// falls back to a working default and returns an explanation (`message`), which
// stays visible under the row so it is never missed.
export function ShortcutsSection() {
	const [rows, setRows] = useState<ShortcutRow[]>([]);
	const [recording, setRecording] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const recordingRef = useRef<string | null>(null);
	recordingRef.current = recording;

	useEffect(() => {
		shortcutList()
			.then(setRows)
			.catch((error) => setProblem(toAiError(error).message));
	}, []);

	const replaceRow = useCallback((updated: ShortcutRow) => {
		setRows((current) => current.map((row) => (row.action === updated.action ? updated : row)));
	}, []);

	// While recording, the next key combination is taken as the new shortcut.
	useEffect(() => {
		if (!recording) return;
		const action = recording;
		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.isComposing) return;
			if (
				event.code === "Escape" &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!event.metaKey
			) {
				setRecording(null);
				return;
			}
			const accelerator = keyboardEventToAccelerator(event);
			// Only modifiers so far: keep waiting for the main key.
			if (!accelerator) return;
			setRecording(null);
			setProblem(null);
			shortcutSet(action, accelerator)
				.then(replaceRow)
				.catch((error) => setProblem(toAiError(error).message));
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [recording, replaceRow]);

	const reset = (action: string) => {
		setProblem(null);
		shortcutReset(action)
			.then(replaceRow)
			.catch((error) => setProblem(toAiError(error).message));
	};

	return (
		<>
			<div className="setting-group-label setting-group-label--spaced">Shortcuts</div>
			<div className="setting-group">
				{rows.map((row, index) => {
					const isRecording = recording === row.action;
					const last = index === rows.length - 1;
					return (
						<div key={row.action} className="shortcut-row">
							<SettingRow
								icon={Keyboard}
								label={row.label}
								desc={SCOPE_NOTE[row.scope]}
								divider={!last || row.message !== null}
							>
								{row.active ? (
									<KeyCaps accelerator={row.active} />
								) : (
									<span className="shortcut-none">Not set</span>
								)}
								<button
									type="button"
									className="settings-button"
									onClick={() => setRecording(isRecording ? null : row.action)}
									aria-label={`Change shortcut for ${row.label}`}
								>
									{isRecording ? "Press keys…" : "Change"}
								</button>
								{row.preferred !== null && (
									<button
										type="button"
										className="settings-icon-button"
										onClick={() => reset(row.action)}
										aria-label={`Reset shortcut for ${row.label}`}
										title="Use the default"
									>
										<RotateCcw size={12} />
									</button>
								)}
							</SettingRow>
							{row.message && (
								<p className="settings-note problem" role="alert">
									{row.message}
								</p>
							)}
						</div>
					);
				})}
			</div>
			{isRecordingHint(recording) && (
				<p className="settings-note" role="status">
					Press the new shortcut, or Esc to cancel.
				</p>
			)}
			{problem && (
				<p className="settings-note problem" role="alert">
					{problem}
				</p>
			)}
			<p className="settings-note">
				A global shortcut may not work while you're in an application running as administrator, in
				some full-screen games, or in a remote desktop window.
			</p>
		</>
	);
}

function isRecordingHint(recording: string | null): boolean {
	return recording !== null;
}
