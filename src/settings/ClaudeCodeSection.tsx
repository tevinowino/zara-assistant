import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BellRing, FileCode } from "../icons/glyphs";
import type { ClaudeCodeConnection } from "../notch/claudeCode/claudeCodeTypes";
import { NOTIFICATION_SETTING_KEYS } from "../notch/notifications/notificationPolicy";
import { useNotificationPreferences } from "../notch/notifications/useNotificationPreferences";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

export interface ClaudeCodeSectionProps {
	/** The Claude Code widget is on in the notch (under Widgets). */
	widgetOn: boolean;
}

/**
 * Where the user connects Claude Code to the notch and chooses which alerts to get.
 *
 * Connecting edits Claude Code's own settings file, so it never happens in one click: the
 * exact text that will be added is shown first, and nothing is written until the user agrees.
 */
export function ClaudeCodeSection({ widgetOn }: ClaudeCodeSectionProps) {
	const { preferences, save } = useNotificationPreferences();
	const [connection, setConnection] = useState<ClaudeCodeConnection | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		invoke<ClaudeCodeConnection>("claude_code_connection")
			.then(setConnection)
			.catch(() => setConnection({ connected: false, settingsPath: null }));
	}, []);

	const connected = connection?.connected === true;

	const showPreview = async () => {
		setProblem(null);
		try {
			setPreview(await invoke<string>("claude_code_hooks_preview"));
		} catch (error) {
			setProblem(String(error));
		}
	};

	const change = async (command: "claude_code_connect" | "claude_code_disconnect") => {
		setBusy(true);
		setProblem(null);
		try {
			setConnection(await invoke<ClaudeCodeConnection>(command));
			setPreview(null);
		} catch (error) {
			setProblem(String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div className="setting-group">
				<SettingRow
					icon={FileCode}
					label="Claude Code"
					desc={
						connected
							? "Connected. Zara hears when a session starts, needs you or finishes."
							: "Show what Claude Code is doing, and get a pill when it needs you"
					}
					divider={connected}
				>
					{connected ? (
						<button
							type="button"
							className="settings-button"
							disabled={busy}
							onClick={() => void change("claude_code_disconnect")}
						>
							Disconnect
						</button>
					) : (
						<button
							type="button"
							className="settings-button"
							disabled={busy || connection === null || preview !== null}
							onClick={() => void showPreview()}
						>
							Connect…
						</button>
					)}
				</SettingRow>

				{connected && (
					<>
						<SettingRow
							icon={BellRing}
							label="Alert When Claude Needs You"
							desc="A pill when a session waits for permission or an answer"
						>
							<SettingSwitch
								checked={preferences.claudeCodeNeedsInput}
								onToggle={() =>
									void save(
										NOTIFICATION_SETTING_KEYS.claudeCodeNeedsInput,
										String(!preferences.claudeCodeNeedsInput)
									)
								}
							/>
						</SettingRow>
						<SettingRow
							icon={BellRing}
							label="Alert When Claude Finishes"
							desc="A pill when a session completes its turn"
							divider={false}
						>
							<SettingSwitch
								checked={preferences.claudeCodeDone}
								onToggle={() =>
									void save(
										NOTIFICATION_SETTING_KEYS.claudeCodeDone,
										String(!preferences.claudeCodeDone)
									)
								}
							/>
						</SettingRow>
					</>
				)}
			</div>

			{preview !== null && (
				<section className="claude-connect" aria-label="Connect Claude Code">
					<p>
						Zara will add these hooks to Claude Code's settings
						{connection?.settingsPath ? (
							<>
								{" "}
								(<code>{connection.settingsPath}</code>)
							</>
						) : null}
						:
					</p>
					<pre className="claude-connect-preview">{preview}</pre>
					<ul>
						<li>
							Each hook runs a small script in the background. It keeps the project's name, the
							session's state and the first few hundred characters of Claude's message. It never
							keeps what you type, or what Claude's tools do.
						</li>
						<li>
							A copy of your current settings is saved beside the file as{" "}
							<code>settings.json.zara-backup</code>. Everything else in the file stays as it is.
						</li>
						<li>Disconnect removes these hooks again.</li>
					</ul>
					<div className="claude-connect-actions">
						<button
							type="button"
							className="settings-button"
							disabled={busy}
							onClick={() => void change("claude_code_connect")}
						>
							Add these hooks
						</button>
						<button
							type="button"
							className="settings-button"
							disabled={busy}
							onClick={() => setPreview(null)}
						>
							Cancel
						</button>
					</div>
				</section>
			)}

			{problem && (
				<p className="settings-note problem" role="alert">
					{problem}
				</p>
			)}

			{connected && !widgetOn && (
				<p className="settings-note">
					Turn on the Claude Code widget under Widgets to see sessions and get alerts.
				</p>
			)}
		</>
	);
}
