import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
	STARTUP_CHECK_DELAY_MS,
	findUpdate,
	offerUpdateAtStartup,
	type StartupOfferDeps
} from "./updates";

/** The real dependencies of the startup offer: the updater, the saved settings and a native dialog. */
const realDeps: StartupOfferDeps = {
	find: findUpdate,
	readSettings: () => invoke<Record<string, string>>("load_settings"),
	saveSetting: (key, value) => invoke<void>("save_setting", { key, value }),
	ask: async (message, title) => {
		const { ask } = await import("@tauri-apps/plugin-dialog");
		return ask(message, { title, kind: "info", okLabel: "Update now", cancelLabel: "Later" });
	}
};

/**
 * Looks for a newer Zara a little after startup and offers to install it. Mounted
 * once by the notch. A development build never checks: it is not an installed
 * release, and there is nothing to update it to.
 */
export function useStartupUpdateOffer(): void {
	useEffect(() => {
		if (import.meta.env.DEV) return;
		const timer = setTimeout(() => void offerUpdateAtStartup(realDeps), STARTUP_CHECK_DELAY_MS);
		return () => clearTimeout(timer);
	}, []);
}
