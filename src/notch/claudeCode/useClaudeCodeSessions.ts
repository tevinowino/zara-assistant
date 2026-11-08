import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeCodeConnection, ClaudeCodeSession } from "./claudeCodeTypes";

export interface ClaudeCodeSessionsController {
	/** The sessions, most recently active first; null until they have been read. */
	sessions: ClaudeCodeSession[] | null;
	/** Whether Claude Code is connected; null until that has been read. */
	connected: boolean | null;
}

/**
 * The Claude Code sessions Zara knows about, kept current while the panel is open: the list
 * follows the backend as hooks report, and the connection is checked when the panel opens.
 */
export function useClaudeCodeSessions(): ClaudeCodeSessionsController {
	const [sessions, setSessions] = useState<ClaudeCodeSession[] | null>(null);
	const [connected, setConnected] = useState<boolean | null>(null);

	const refresh = useCallback(async () => {
		try {
			setSessions(await invoke<ClaudeCodeSession[]>("claude_code_sessions"));
		} catch {
			setSessions([]);
		}
	}, []);

	useEffect(() => {
		void refresh();
		invoke<ClaudeCodeConnection>("claude_code_connection")
			.then((connection) => setConnected(connection.connected))
			.catch(() => setConnected(false));
		const unlisten = listen("claude-code-changed", () => void refresh());
		return () => {
			void unlisten.then((stop) => stop());
		};
	}, [refresh]);

	return { sessions, connected };
}
