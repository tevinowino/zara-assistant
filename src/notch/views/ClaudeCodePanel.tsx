import { useEffect, useState } from "react";
import { describeNoteAge } from "../notes/noteAge";
import { SESSION_STATE_LABEL, type ClaudeCodeSession } from "../claudeCode/claudeCodeTypes";
import { useClaudeCodeSessions } from "../claudeCode/useClaudeCodeSessions";
import { useClaudeUsage } from "../claudeCode/useClaudeUsage";
import { useClaudeUsagePreferences } from "../claudeCode/useClaudeUsagePreferences";
import type { ZaraMode } from "../types";
import { WidgetPanelShell } from "../widgets/WidgetPanelShell";
import { ClaudeUsageView } from "./ClaudeUsageView";
import "./ClaudeCodePanel.css";

/** Size of the notch while it shows Claude Code, including its 36px top row. */
export const CLAUDE_CODE_PANEL_WIDTH_PX = 760;
export const CLAUDE_CODE_PANEL_HEIGHT_PX = 440;

/** How often the ages ("2 min ago") are refreshed, in milliseconds. */
const AGE_REFRESH_MS = 30_000;

type Tab = "usage" | "sessions";

export interface ClaudeCodePanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "claude-code". */
	zaraMode: ZaraMode;
}

/**
 * The Claude Code widget. Usage (the default view) counts tokens, tool calls, hours and
 * estimated cost from Claude Code's transcripts; Sessions lists what each running session is
 * doing and what Claude last said, from the hooks.
 */
export function ClaudeCodePanel({ zaraMode }: ClaudeCodePanelProps) {
	return (
		<WidgetPanelShell panel="claude-code" zaraMode={zaraMode} className="claude-panel" ownsScroll>
			<ClaudeCodeContent />
		</WidgetPanelShell>
	);
}

function ClaudeCodeContent() {
	const [tab, setTab] = useState<Tab>("usage");
	return (
		<>
			<div className="claude-tabs" role="tablist" aria-label="Claude Code views">
				{(["usage", "sessions"] as const).map((name) => (
					<button
						key={name}
						type="button"
						role="tab"
						aria-selected={tab === name}
						onClick={() => setTab(name)}
					>
						{name === "usage" ? "Usage" : "Sessions"}
					</button>
				))}
			</div>
			{tab === "usage" ? <UsageTab /> : <SessionsTab />}
		</>
	);
}

function UsageTab() {
	const preferences = useClaudeUsagePreferences();
	const usage = useClaudeUsage(preferences.allowed);
	return (
		<ClaudeUsageView
			allowed={preferences.allowed}
			onAllow={() => preferences.setAllowed(true)}
			usage={usage}
			budgetUsd={preferences.budgetUsd}
			onSetBudget={preferences.setBudgetUsd}
		/>
	);
}

function SessionsTab() {
	const { sessions, connected } = useClaudeCodeSessions();
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), AGE_REFRESH_MS);
		return () => clearInterval(interval);
	}, []);

	if (connected === false) {
		return (
			<p className="claude-message">
				Claude Code is not connected yet. Connect it in Settings, under Notch, Claude Code.
			</p>
		);
	}
	if (sessions === null) return null;
	if (sessions.length === 0) {
		return (
			<p className="claude-message">
				No Claude Code sessions yet. Start one and it will show up here.
			</p>
		);
	}
	return (
		<ul className="claude-sessions" aria-label="Claude Code sessions">
			{sessions.map((session) => (
				<SessionCard key={session.sessionId} session={session} now={now} />
			))}
		</ul>
	);
}

function SessionCard({ session, now }: { session: ClaudeCodeSession; now: number }) {
	return (
		<li className="claude-session" data-state={session.state}>
			<div className="claude-session-top">
				<span className="claude-session-dot" aria-hidden="true" />
				<strong className="claude-session-project">{session.project}</strong>
				<span className="claude-session-state">{SESSION_STATE_LABEL[session.state]}</span>
				<span className="claude-session-age">{describeNoteAge(session.updatedAtMs, now)}</span>
			</div>
			{session.title && <span className="claude-session-title">{session.title}</span>}
			{session.excerpt && <span className="claude-session-excerpt">{session.excerpt}</span>}
		</li>
	);
}
