import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, BellRing, EyeOff, Timer } from "../icons/glyphs";
import {
	NOTIFICATION_SETTING_KEYS,
	withAppAllowed
} from "../notch/notifications/notificationPolicy";
import { useNotificationPreferences } from "../notch/notifications/useNotificationPreferences";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

/** The times a pill can stay, in milliseconds. */
const DURATION_CHOICES_MS = [3000, 5000, 8000, 12000] as const;

/**
 * Where the user chooses whether Windows notifications pop up in the notch, which apps may do
 * it, and how much of the notification is shown. Nothing is read until the feature is turned
 * on, and then no app shows a pill until it is allowed here.
 */
export function NotificationsSection() {
	const { preferences, save } = useNotificationPreferences();
	const [accessProblem, setAccessProblem] = useState<"denied" | "unavailable" | null>(null);

	const turnOn = async () => {
		const answer = await invoke<string>("notifications_enable", { enabled: true }).catch(
			() => "unavailable"
		);
		if (answer !== "allowed") {
			setAccessProblem(answer === "denied" ? "denied" : "unavailable");
			return;
		}
		setAccessProblem(null);
		await save(NOTIFICATION_SETTING_KEYS.enabled, "true");
	};

	const turnOff = async () => {
		setAccessProblem(null);
		await save(NOTIFICATION_SETTING_KEYS.enabled, "false");
		invoke("notifications_enable", { enabled: false }).catch(() => {});
	};

	return (
		<>
			<div className="setting-group">
				<SettingRow
					icon={BellRing}
					label="Notification Pill"
					desc="Show Windows notifications from the apps you allow in the notch"
					divider={preferences.enabled}
				>
					<SettingSwitch
						checked={preferences.enabled}
						onToggle={() => void (preferences.enabled ? turnOff() : turnOn())}
					/>
				</SettingRow>

				{preferences.enabled && (
					<>
						<SettingRow
							icon={EyeOff}
							label="Show Message Text"
							desc="Off shows only the app's name"
						>
							<SettingSwitch
								checked={preferences.showText}
								onToggle={() =>
									void save(NOTIFICATION_SETTING_KEYS.showText, String(!preferences.showText))
								}
							/>
						</SettingRow>
						<SettingRow
							icon={Timer}
							label="Time Shown"
							desc="How long a notification stays in the notch"
							divider={preferences.seenApps.length > 0}
						>
							<select
								className="settings-select"
								aria-label="Time shown"
								value={preferences.durationMs}
								onChange={(event) =>
									void save(NOTIFICATION_SETTING_KEYS.durationMs, event.target.value)
								}
							>
								{DURATION_CHOICES_MS.map((milliseconds) => (
									<option key={milliseconds} value={milliseconds}>
										{milliseconds / 1000} seconds
									</option>
								))}
							</select>
						</SettingRow>
					</>
				)}
			</div>

			{accessProblem && (
				<p className="settings-note problem" role="alert">
					{accessProblem === "denied"
						? "Windows is not letting Zara read notifications. "
						: "Windows notifications are not available here. "}
					<button
						type="button"
						className="settings-link"
						onClick={() => invoke("open_notification_privacy_settings").catch(() => {})}
					>
						Open Windows notification settings
					</button>
				</p>
			)}

			{preferences.enabled && (
				<>
					<div className="setting-group-label">Apps</div>
					{preferences.seenApps.length === 0 ? (
						<p className="settings-note">
							Apps show up here the first time they send a notification. None of them appears in the
							notch until you turn it on.
						</p>
					) : (
						<div className="setting-group">
							{preferences.seenApps.map((app, index) => (
								<SettingRow
									key={app.id}
									icon={AppWindow}
									label={app.name}
									divider={index < preferences.seenApps.length - 1}
								>
									<SettingSwitch
										checked={preferences.allowedAppIds.includes(app.id)}
										onToggle={() =>
											void save(
												NOTIFICATION_SETTING_KEYS.allowedApps,
												JSON.stringify(
													withAppAllowed(
														preferences.allowedAppIds,
														app.id,
														!preferences.allowedAppIds.includes(app.id)
													)
												)
											)
										}
									/>
								</SettingRow>
							))}
						</div>
					)}
					<p className="settings-note">
						Windows still shows its own notification too. To see only the notch, turn off banners
						for that app in Windows settings. What a notification says is only held in memory long
						enough to show it; nothing is saved or sent anywhere.
					</p>
				</>
			)}
		</>
	);
}
