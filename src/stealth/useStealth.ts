import { useCallback, useEffect, useState } from "react";
import { stealthSet, stealthStatus, stealthVerify, type StealthStatus } from "../ai/api";
import { useSettingsSync } from "../hooks/useSettingsSync";

/** The setting the backend stores the user's choice under (see stealth.rs). */
export const STEALTH_SETTING_KEY = "zara-stealth-enabled";

export interface StealthController {
	/** What the user asked for and what is true right now; null until known, or when it cannot be read. */
	status: StealthStatus | null;
	/** A change or a check is in progress; the controls should wait. */
	busy: boolean;
	/** Turns stealth on when it is off and off when it is on. */
	toggle: () => Promise<void>;
	/** Re-applies the setting to every window and reads back whether it took hold. */
	verify: () => Promise<void>;
}

/**
 * Stealth mode, which hides Zara's windows from screen capture and sharing. Everything that
 * shows or changes it (the Settings switch, the assistant's header button, the notch's
 * indicator) uses this one hook, so they cannot disagree. A change made in another window
 * arrives through the settings channel and is read back here.
 */
export function useStealth(): StealthController {
	const [status, setStatus] = useState<StealthStatus | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setStatus(await stealthStatus());
		} catch {
			setStatus(null);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useSettingsSync({ [STEALTH_SETTING_KEY]: () => void refresh() });

	const toggle = useCallback(async () => {
		if (!status || busy) return;
		setBusy(true);
		try {
			setStatus(await stealthSet(!status.requested));
		} catch {
			await refresh();
		} finally {
			setBusy(false);
		}
	}, [status, busy, refresh]);

	const verify = useCallback(async () => {
		setBusy(true);
		try {
			setStatus(await stealthVerify());
		} finally {
			setBusy(false);
		}
	}, []);

	return { status, busy, toggle, verify };
}
