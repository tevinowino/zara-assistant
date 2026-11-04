import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "../../icons/glyphs";
import type { Note } from "../../ai/types";
import { describeNoteAge } from "../notes/noteAge";
import { useNotes } from "../notes/useNotes";
import type { ZaraMode } from "../types";

/** Size of the notch while it shows the notes, including its 36px top row. */
export const NOTES_PANEL_WIDTH_PX = 380;
export const NOTES_PANEL_HEIGHT_PX = 300;

export interface NotesPanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "notes". */
	zaraMode: ZaraMode;
	/**
	 * Called when a text field in the panel gains or loses the caret, including when it is
	 * removed while focused, so the notch can take and give back keyboard focus.
	 */
	onFieldFocusChange: (focused: boolean) => void;
}

/** The notes widget: write a note, see the latest ones, edit or delete them. */
export function NotesPanel({ zaraMode, onFieldFocusChange }: NotesPanelProps) {
	return (
		<AnimatePresence>
			{zaraMode === "notes" && (
				<motion.div
					className="notes-panel"
					onClick={(event) => event.stopPropagation()}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
				>
					<NotesContent onFieldFocusChange={onFieldFocusChange} />
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/**
 * Focus handlers for one text field, reporting its caret to the notch. If the field is taken
 * away while it still has the caret (a note finishing its edit), that is reported too,
 * because the browser does not send a blur for a field that is removed.
 */
function useFieldFocusReporter(onFieldFocusChange: (focused: boolean) => void) {
	const focused = useRef(false);
	const report = useRef(onFieldFocusChange);
	report.current = onFieldFocusChange;

	useEffect(
		() => () => {
			if (focused.current) report.current(false);
		},
		[]
	);

	return {
		onFocus: () => {
			focused.current = true;
			report.current(true);
		},
		onBlur: () => {
			focused.current = false;
			report.current(false);
		}
	};
}

interface NoteEditorProps {
	value: string;
	onChange: (value: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onLeave: () => void;
	onFieldFocusChange: (focused: boolean) => void;
}

/** The text area a note is edited in. */
function NoteEditor({ value, onChange, onKeyDown, onLeave, onFieldFocusChange }: NoteEditorProps) {
	const focusProps = useFieldFocusReporter(onFieldFocusChange);
	return (
		<textarea
			className="note-edit"
			value={value}
			rows={3}
			autoFocus
			aria-label="Edit note"
			onChange={(event) => onChange(event.target.value)}
			onKeyDown={onKeyDown}
			onFocus={focusProps.onFocus}
			onBlur={() => {
				focusProps.onBlur();
				onLeave();
			}}
		/>
	);
}

function NotesContent({ onFieldFocusChange }: { onFieldFocusChange: (focused: boolean) => void }) {
	const { notes, failed, add, update, remove } = useNotes();
	const focusProps = useFieldFocusReporter(onFieldFocusChange);
	const [draft, setDraft] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	// The note being edited, read by the handlers below, which can run after it has been left.
	const editingIdRef = useRef<string | null>(null);
	const [editDraft, setEditDraft] = useState("");
	const now = Date.now();

	const submitNew = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft;
		if (text.trim() === "") return;
		setDraft("");
		if (!(await add(text))) setDraft(text);
	};

	const startEditing = (note: Note) => {
		editingIdRef.current = note.id;
		setEditingId(note.id);
		setEditDraft(note.text);
	};

	const finishEditing = async (note: Note, save: boolean) => {
		// Leaving the field can report twice (Enter, then the field going away); once is enough.
		if (editingIdRef.current !== note.id) return;
		editingIdRef.current = null;
		setEditingId(null);
		if (save && editDraft.trim() !== "" && editDraft.trim() !== note.text) {
			await update(note.id, editDraft);
		}
	};

	const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, note: Note) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			void finishEditing(note, true);
		} else if (event.key === "Escape") {
			event.stopPropagation();
			void finishEditing(note, false);
		}
	};

	return (
		<>
			<form className="notes-add" onSubmit={submitNew}>
				<input
					className="notes-add-field"
					type="text"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Add a note"
					aria-label="New note"
					autoComplete="off"
					spellCheck={false}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							event.currentTarget.blur();
						}
					}}
					{...focusProps}
				/>
				<button
					type="submit"
					className="notes-add-button"
					aria-label="Add note"
					disabled={draft.trim() === ""}
				>
					<Plus size={15} strokeWidth={2.4} />
				</button>
			</form>

			{failed && <p className="notes-message">Notes could not be loaded.</p>}
			{!failed && notes !== null && notes.length === 0 && (
				<p className="notes-message">No notes yet. Type one above.</p>
			)}

			{notes !== null && notes.length > 0 && (
				<ul className="notes-list" aria-label="Notes">
					{notes.map((note) => (
						<li key={note.id} className="note-card" data-color={note.color}>
							{editingId === note.id ? (
								<NoteEditor
									value={editDraft}
									onChange={setEditDraft}
									onKeyDown={(event) => onEditKeyDown(event, note)}
									onLeave={() => void finishEditing(note, true)}
									onFieldFocusChange={onFieldFocusChange}
								/>
							) : (
								<button
									type="button"
									className="note-body"
									onClick={() => startEditing(note)}
									title="Click to edit"
								>
									{note.title && <strong className="note-title">{note.title}</strong>}
									<span className="note-text">{note.text}</span>
									<span className="note-age">{describeNoteAge(note.updatedAt, now)}</span>
								</button>
							)}
							<button
								type="button"
								className="note-delete"
								aria-label={`Delete note: ${note.text.slice(0, 40)}`}
								onClick={() => void remove(note.id)}
							>
								<X size={13} strokeWidth={2.4} />
							</button>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
