import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UsageSummary } from "./usageTypes";

/** How often the numbers are refreshed while the dashboard is open, in milliseconds. */
const REFRESH_INTERVAL_MS = 20_000;
/** After Claude Code reports activity, wait this long (so a burst is one refresh), in milliseconds. */
const ACTIVITY_DEBOUNCE_MS = 1_500;

export type ClaudeUsageState =
	/** The user has not allowed counting, so nothing is read. */
	| { status: "off" }
	| { status: "loading" }
	| { status: "ready"; summary: UsageSummary }
	| { status: "error" };

/**
 * Claude Code's usage numbers, refreshed while the dashboard is open and soon after Claude Code
 * reports activity. Nothing is asked of the backend unless `allowed` (the user's choice).
 */
export function useClaudeUsage(allowed: boolean): ClaudeUsageState {
	const [state, setState] = useState<ClaudeUsageState>({ status: allowed ? "loading" : "off" });
	const latestRequest = useRef(0);

	const refresh = useCallback(async () => {
		const request = ++latestRequest.current;
		try {
			const summary = await invoke<UsageSummary>("claude_usage_summary", {
				nowMs: Date.now(),
				utcOffsetMinutes: -new Date().getTimezoneOffset()
			});
			if (request === latestRequest.current) setState({ status: "ready", summary });
		} catch {
			if (request === latestRequest.current) {
				// Keep showing numbers already on screen rather than replacing them with an error.
				setState((current) => (current.status === "ready" ? current : { status: "error" }));
			}
		}
	}, []);

	useEffect(() => {
		if (!allowed) {
			latestRequest.current++;
			setState({ status: "off" });
			return;
		}
		setState((current) => (current.status === "ready" ? current : { status: "loading" }));
		void refresh();
		const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
		let debounce: ReturnType<typeof setTimeout> | null = null;
		const unlisten = listen("claude-code-changed", () => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => void refresh(), ACTIVITY_DEBOUNCE_MS);
		});
		return () => {
			clearInterval(interval);
			if (debounce) clearTimeout(debounce);
			void unlisten.then((stop) => stop());
		};
	}, [allowed, refresh]);

	return state;
}
