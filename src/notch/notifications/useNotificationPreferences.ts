import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import {
	NOTIFICATION_SETTING_KEYS,
	parseNotificationPreferences,
	type NotificationPreferences
} from "./notificationPolicy";

const readStoredPreferences = () =>
	parseNotificationPreferences((key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	});

export interface NotificationPreferencesController {
	preferences: NotificationPreferences;
	/** Saves one of the notification settings (see `NOTIFICATION_SETTING_KEYS`) and applies it. */
	save: (key: string, value: string) => Promise<void>;
}

/**
 * The user's notification choices, kept current across the notch and the Settings window: the
 * browser's copy first so the first paint is right, then the saved file, then every change
 * made in either window.
 */
export function useNotificationPreferences(): NotificationPreferencesController {
	const [preferences, setPreferences] = useState(readStoredPreferences);

	useEffect(() => {
		let cancelled = false;
		invoke<Record<string, unknown>>("load_settings")
			.then((settings) => {
				if (cancelled) return;
				setPreferences(
					parseNotificationPreferences((key) => {
						const saved = settings?.[key];
						if (saved !== undefined && saved !== null) return String(saved);
						try {
							return localStorage.getItem(key);
						} catch {
							return null;
						}
					})
				);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	// The sync hook has already mirrored the changed value into localStorage when it calls us.
	useSettingsSync(
		Object.fromEntries(
			Object.values(NOTIFICATION_SETTING_KEYS).map((key) => [
				key,
				() => setPreferences(readStoredPreferences())
			])
		)
	);

	const save = useCallback(async (key: string, value: string) => {
		await invoke("save_setting", { key, value });
		try {
			localStorage.setItem(key, value);
		} catch {
			// The saved file is the source of truth; the browser's copy is only for the first paint.
		}
		setPreferences(readStoredPreferences());
	}, []);

	return { preferences, save };
}
