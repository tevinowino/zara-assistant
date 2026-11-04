import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** One thing the user copied, as the backend remembers it. */
export interface ClipboardEntry {
	id: number;
	text: string;
	/** Milliseconds since the Unix epoch. */
	copiedAt: number;
}

export interface ClipboardController {
	/** What was copied, the newest first; null until it has been read. */
	entries: ClipboardEntry[] | null;
	/** The history could not be read. */
	failed: boolean;
	/** Puts an entry back on the clipboard. False if that did not work. */
	copyAgain: (entry: ClipboardEntry) => Promise<boolean>;
	remove: (id: number) => Promise<void>;
	clearAll: () => Promise<void>;
}

/**
 * The clipboard history kept by the backend while the Clipboard widget is on. The list
 * follows the backend as things are copied, including while the panel is open.
 */
export function useClipboardHistory(): ClipboardController {
	const [entries, setEntries] = useState<ClipboardEntry[] | null>(null);
	const [failed, setFailed] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setEntries(await invoke<ClipboardEntry[]>("clipboard_history_list"));
			setFailed(false);
		} catch {
			setFailed(true);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const unlisten = listen("clipboard-history-changed", () => void refresh());
		return () => {
			void unlisten.then((stop) => stop());
		};
	}, [refresh]);

	const copyAgain = useCallback(async (entry: ClipboardEntry) => {
		try {
			await writeText(entry.text);
			return true;
		} catch {
			return false;
		}
	}, []);

	const remove = useCallback(
		async (id: number) => {
			try {
				await invoke("clipboard_history_remove", { id });
			} catch {
				// The list read back below shows whether it is gone.
			}
			await refresh();
		},
		[refresh]
	);

	const clearAll = useCallback(async () => {
		try {
			await invoke("clipboard_history_clear");
		} catch {
			// The list read back below shows whether it is gone.
		}
		await refresh();
	}, [refresh]);

	return { entries, failed, copyAgain, remove, clearAll };
}

/**
 * Tells the backend to watch the clipboard while the widget is on, and to stop (and forget
 * everything) when it is turned off. Nothing is watched while `enabled` is false, which
 * includes in every window but the notch.
 */
export function useClipboardMonitor(enabled: boolean): void {
	useEffect(() => {
		invoke("clipboard_history_enable", { enabled }).catch(() => {});
	}, [enabled]);
}
