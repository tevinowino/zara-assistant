import { useCallback, useEffect, useState } from "react";
import { noteAdd, noteDelete, noteList, noteUpdate } from "../../ai/api";
import type { Note } from "../../ai/types";

export interface NotesController {
	/** The notes, the most recently changed first; null until they have been read. */
	notes: Note[] | null;
	/** The notes could not be read. */
	failed: boolean;
	/** Saves a new note. False when there was nothing to save or it could not be saved. */
	add: (text: string) => Promise<boolean>;
	/** Replaces a note's text. False when it was empty or could not be saved. */
	update: (id: string, text: string) => Promise<boolean>;
	/** Deletes a note; the list then shows whether it is gone. */
	remove: (id: string) => Promise<void>;
}

const newestFirst = (notes: Note[]) => [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

/**
 * The user's notes, the same ones the assistant adds to and edits (Settings → Library shows
 * them too). Every change is read back from the store, so what is shown is what is saved,
 * including anything the assistant changed since the list was last read.
 */
export function useNotes(): NotesController {
	const [notes, setNotes] = useState<Note[] | null>(null);
	const [failed, setFailed] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setNotes(newestFirst(await noteList()));
			setFailed(false);
		} catch {
			setFailed(true);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const add = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (trimmed === "") return false;
			try {
				const saved = await noteAdd(trimmed);
				await refresh();
				return saved !== null;
			} catch {
				return false;
			}
		},
		[refresh]
	);

	const update = useCallback(
		async (id: string, text: string) => {
			const trimmed = text.trim();
			if (trimmed === "") return false;
			try {
				const { success } = await noteUpdate(id, trimmed);
				await refresh();
				return success;
			} catch {
				return false;
			}
		},
		[refresh]
	);

	const remove = useCallback(
		async (id: string) => {
			try {
				await noteDelete(id);
			} catch {
				// The list read back below shows whether the note is still there.
			}
			await refresh();
		},
		[refresh]
	);

	return { notes, failed, add, update, remove };
}
