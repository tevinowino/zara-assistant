// Types shared by the assistant UI. They mirror what the Rust backend sends
// (src-tauri/src/ai); field names are camelCase on the wire.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
	id: string;
	role: ChatRole;
	text: string;
	createdAt: number;
	/**
	 * How the answer was reached. Kept for the conversation on screen only: it is
	 * not saved with the conversation, so a chat opened later has none.
	 */
	thinking?: ThinkingTrace;
}

/** What Zara can be doing while it works out an answer. */
export type ThinkingStepKind = "understand" | "screen" | "notes" | "web";

/** One stage of working out an answer; `endedAt` is null while it is going on. */
export interface ThinkingStep {
	kind: ThinkingStepKind;
	/** Milliseconds since the epoch. */
	startedAt: number;
	endedAt: number | null;
}

/**
 * Everything the panel knows about how an answer was reached: the stages, in the
 * order they happened, and the model's own reasoning when its service sends it
 * (many do not, and then it is empty). `endedAt` is when the answer began to be
 * written, and null until then.
 */
export interface ThinkingTrace {
	startedAt: number;
	endedAt: number | null;
	steps: ThinkingStep[];
	reasoning: string;
}

/** What the backend returns for one chat turn. */
export interface ChatOutcome {
	text: string;
	usedScreen: boolean;
	usedNotes: boolean;
	/** Facts newly saved to memory by this reply. */
	savedMemories: string[];
	/** Human-readable lines such as `Added: "buy milk"`. */
	noteChanges: string[];
}

/**
 * A failure from the backend. `kind` is a stable identifier (for example
 * "key-missing" or "rate-limited"); `message` is already written for the user.
 */
export interface AiErrorInfo {
	kind: string;
	message: string;
}

/** One earlier turn, in the role names the model API uses. */
export interface HistoryTurn {
	role: "user" | "model";
	text: string;
}

export interface ConversationSummary {
	id: string;
	title: string;
	updatedAt: number;
}

export interface StoredConversation {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

export interface MemoryEntry {
	id: string;
	text: string;
	createdAt: number;
}

export type NoteColor = "yellow" | "pink" | "blue" | "purple" | "green";

export interface Note {
	id: string;
	title: string;
	text: string;
	color: NoteColor;
	createdAt: number;
	updatedAt: number;
}
