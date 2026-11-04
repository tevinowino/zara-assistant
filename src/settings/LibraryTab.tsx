import { useCallback, useEffect, useState } from "react";
import { BookOpen, Brain, Download, MessageSquare, NotebookPen, Plus, Trash2 } from "lucide-react";
import { emit, listen } from "@tauri-apps/api/event";
import {
	convDelete,
	convList,
	legacyImportDismiss,
	legacyImportRun,
	legacyImportStatus,
	memoryAdd,
	memoryDelete,
	memoryList,
	noteAdd,
	noteDelete,
	noteList,
	noteUpdate,
	toAiError,
	type ImportSummary,
	type LegacyStatus
} from "../ai/api";
import type { ConversationSummary, MemoryEntry, Note } from "../ai/types";
import { SettingRow } from "./SettingRow";

/** Tells the notch (a different window) to open a saved conversation. */
export const OPEN_CONVERSATION_EVENT = "ai-open-conversation";

const COLOR_DOT: Record<Note["color"], string> = {
	yellow: "#fbbf24",
	pink: "#fb7185",
	blue: "#60a5fa",
	purple: "#c084fc",
	green: "#34d399"
};

function describeImport(summary: ImportSummary): string {
	const parts = [
		`${summary.notes} ${summary.notes === 1 ? "note" : "notes"}`,
		`${summary.conversations} ${summary.conversations === 1 ? "conversation" : "conversations"}`,
		`${summary.memories} ${summary.memories === 1 ? "memory" : "memories"}`
	];
	return `Imported ${parts.join(", ")}.`;
}

function formatDate(milliseconds: number): string {
	return new Date(milliseconds).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric"
	});
}

export function LibraryTab() {
	const [notes, setNotes] = useState<Note[]>([]);
	const [memories, setMemories] = useState<MemoryEntry[]>([]);
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [legacy, setLegacy] = useState<LegacyStatus | null>(null);
	const [importResult, setImportResult] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [noteDraft, setNoteDraft] = useState("");
	const [memoryDraft, setMemoryDraft] = useState("");
	const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

	const fail = (error: unknown) => setProblem(toAiError(error).message);

	const refreshNotes = useCallback(() => noteList().then(setNotes).catch(fail), []);
	const refreshMemories = useCallback(() => memoryList().then(setMemories).catch(fail), []);
	const refreshConversations = useCallback(() => convList().then(setConversations).catch(fail), []);

	useEffect(() => {
		void refreshNotes();
		void refreshMemories();
		void refreshConversations();
		legacyImportStatus()
			.then(setLegacy)
			.catch(() => setLegacy(null));
		// The assistant can add notes and memories while this window is open.
		const unlisteners = [
			listen("ai-notes-changed", () => void refreshNotes()),
			listen("ai-memories-changed", () => void refreshMemories())
		];
		return () => {
			unlisteners.forEach((promise) => promise.then((stop) => stop()));
		};
	}, [refreshNotes, refreshMemories, refreshConversations]);

	const addNote = async () => {
		const text = noteDraft.trim();
		if (!text) return;
		setNoteDraft("");
		try {
			await noteAdd(text);
			await refreshNotes();
		} catch (error) {
			fail(error);
		}
	};

	const saveEdit = async () => {
		if (!editing) return;
		const { id, text } = editing;
		setEditing(null);
		try {
			await noteUpdate(id, text);
			await refreshNotes();
		} catch (error) {
			fail(error);
		}
	};

	const addMemory = async () => {
		const text = memoryDraft.trim();
		if (!text) return;
		setMemoryDraft("");
		try {
			await memoryAdd(text);
			await refreshMemories();
		} catch (error) {
			fail(error);
		}
	};

	const runImport = async () => {
		try {
			const summary = await legacyImportRun();
			setImportResult(describeImport(summary));
			setLegacy(null);
			await Promise.all([refreshNotes(), refreshMemories(), refreshConversations()]);
		} catch (error) {
			fail(error);
		}
	};

	const dismissImport = async () => {
		await legacyImportDismiss().catch(() => {});
		setLegacy(null);
	};

	return (
		<>
			{legacy?.available && (
				<div className="setting-group">
					<SettingRow
						icon={Download}
						label="Import from your previous Zara"
						desc={`Found ${legacy.notes} notes, ${legacy.conversations} conversations and ${legacy.memories} memories. They are copied; the old files are not changed.`}
						divider={false}
					>
						<button type="button" className="settings-button" onClick={() => void runImport()}>
							Import
						</button>
						<button
							type="button"
							className="settings-button secondary"
							onClick={() => void dismissImport()}
						>
							Not now
						</button>
					</SettingRow>
				</div>
			)}
			{importResult && (
				<p className="settings-note ok" role="status">
					{importResult}
				</p>
			)}
			{problem && (
				<p className="settings-note problem" role="alert">
					{problem}
				</p>
			)}

			<div className="setting-group-label">Notes</div>
			<div className="setting-group">
				{notes.length === 0 && <p className="library-empty">No notes yet.</p>}
				{notes.map((note) => (
					<div key={note.id} className="library-item">
						<span
							className="library-dot"
							style={{ background: COLOR_DOT[note.color] }}
							aria-hidden="true"
						/>
						{editing?.id === note.id ? (
							<textarea
								className="library-edit"
								value={editing.text}
								onChange={(event) => setEditing({ id: note.id, text: event.target.value })}
								aria-label={`Edit note ${note.title}`}
								autoFocus
							/>
						) : (
							<div className="library-text">
								<strong>{note.title}</strong>
								<span>{note.text}</span>
							</div>
						)}
						{editing?.id === note.id ? (
							<button type="button" className="settings-button" onClick={() => void saveEdit()}>
								Save
							</button>
						) : (
							<button
								type="button"
								className="settings-button secondary"
								onClick={() => setEditing({ id: note.id, text: note.text })}
								aria-label={`Edit note ${note.title}`}
							>
								Edit
							</button>
						)}
						<button
							type="button"
							className="settings-icon-button"
							onClick={() => void noteDelete(note.id).then(refreshNotes).catch(fail)}
							aria-label={`Delete note ${note.title}`}
						>
							<Trash2 size={12} />
						</button>
					</div>
				))}
				<div className="library-add">
					<NotebookPen size={14} aria-hidden="true" />
					<input
						className="settings-input wide"
						value={noteDraft}
						onChange={(event) => setNoteDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) void addNote();
						}}
						placeholder="Add a note"
						aria-label="New note"
					/>
					<button
						type="button"
						className="settings-icon-button"
						onClick={() => void addNote()}
						aria-label="Add note"
					>
						<Plus size={14} />
					</button>
				</div>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Memory</div>
			<div className="setting-group">
				{memories.length === 0 && (
					<p className="library-empty">
						Zara has not saved anything about you. It saves lasting facts when you share them.
					</p>
				)}
				{memories.map((memory) => (
					<div key={memory.id} className="library-item">
						<Brain size={14} aria-hidden="true" />
						<div className="library-text">
							<span>{memory.text}</span>
						</div>
						<button
							type="button"
							className="settings-icon-button"
							onClick={() => void memoryDelete(memory.id).then(refreshMemories).catch(fail)}
							aria-label={`Forget ${memory.text}`}
						>
							<Trash2 size={12} />
						</button>
					</div>
				))}
				<div className="library-add">
					<Brain size={14} aria-hidden="true" />
					<input
						className="settings-input wide"
						value={memoryDraft}
						onChange={(event) => setMemoryDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) void addMemory();
						}}
						placeholder="Tell Zara something to remember"
						aria-label="New memory"
					/>
					<button
						type="button"
						className="settings-icon-button"
						onClick={() => void addMemory()}
						aria-label="Add memory"
					>
						<Plus size={14} />
					</button>
				</div>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Conversations</div>
			<div className="setting-group">
				{conversations.length === 0 && <p className="library-empty">No saved conversations yet.</p>}
				{conversations.map((conversation) => (
					<div key={conversation.id} className="library-item">
						<MessageSquare size={14} aria-hidden="true" />
						<div className="library-text">
							<strong>{conversation.title}</strong>
							<span>{formatDate(conversation.updatedAt)}</span>
						</div>
						<button
							type="button"
							className="settings-button secondary"
							onClick={() => void emit(OPEN_CONVERSATION_EVENT, conversation.id)}
							aria-label={`Open ${conversation.title}`}
						>
							<BookOpen size={12} /> Open
						</button>
						<button
							type="button"
							className="settings-icon-button"
							onClick={() =>
								void convDelete(conversation.id).then(refreshConversations).catch(fail)
							}
							aria-label={`Delete ${conversation.title}`}
						>
							<Trash2 size={12} />
						</button>
					</div>
				))}
			</div>
		</>
	);
}
