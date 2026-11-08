/** What a Claude Code session is doing. */
export type SessionState = "working" | "needsInput" | "done" | "idle";

/** One Claude Code session, as the backend sends it. */
export interface ClaudeCodeSession {
	sessionId: string;
	/** The folder's name, e.g. "zara". */
	project: string;
	title: string | null;
	state: SessionState;
	/** What Claude last said, cut short, when it is waiting or finished. */
	excerpt: string | null;
	/** Milliseconds since the Unix epoch. */
	updatedAtMs: number;
}

/** Whether Zara's hooks are in Claude Code's settings. */
export interface ClaudeCodeConnection {
	connected: boolean;
	/** The path of Claude Code's settings file. */
	settingsPath: string | null;
}

/** How a session's state is named in the panel. */
export const SESSION_STATE_LABEL: Record<SessionState, string> = {
	working: "Working",
	needsInput: "Needs you",
	done: "Done",
	idle: "Idle"
};
