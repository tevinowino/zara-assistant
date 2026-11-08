import { useEffect, useState } from "react";
import { describeNoteAge } from "../notes/noteAge";
import { SESSION_STATE_LABEL, type ClaudeCodeSession } from "../claudeCode/claudeCodeTypes";
import { useClaudeCodeSessions } from "../claudeCode/useClaudeCodeSessions";
import type { ZaraMode } from "../types";
import { WidgetPanelShell } from "../widgets/WidgetPanelShell";
import "./ClaudeCodePanel.css";

/** Size of the notch while it shows Claude Code, including its 36px top row. */
export const CLAUDE_CODE_PANEL_WIDTH_PX = 380;
export const CLAUDE_CODE_PANEL_HEIGHT_PX = 300;

/** How often the ages ("2 min ago") are refreshed, in milliseconds. */
const AGE_REFRESH_MS = 30_000;

export interface ClaudeCodePanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "claude-code". */
	zaraMode: ZaraMode;
}

/** The Claude Code widget: each session, what it is doing, and what Claude last said. */
export function ClaudeCodePanel({ zaraMode }: ClaudeCodePanelProps) {
	return (
		<WidgetPanelShell panel="claude-code" zaraMode={zaraMode} className="claude-panel" ownsScroll>
			<ClaudeCodeContent />
		</WidgetPanelShell>
	);
}

function ClaudeCodeContent() {
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
