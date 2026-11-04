import { check } from "@tauri-apps/plugin-updater";

/**
 * Updates to Zara itself. A release on GitHub carries a signed installer and a
 * small file (`latest.json`) naming the newest version; the updater plugin checks
 * that file, verifies the installer's signature against the public key built into
 * the app, installs it and restarts Zara. Nothing here sends anything about the
 * user: the check is one request for a public file.
 */

/** The setting that turns the check at startup off, when it is "false". */
export const AUTO_UPDATE_SETTING = "zara-auto-update-check";

/** The newest version the user chose "Later" for, so it is not offered at every launch. */
export const SKIPPED_UPDATE_SETTING = "zara-update-skipped-version";

/** How long after startup the quiet check waits, so it never competes with Zara opening. */
export const STARTUP_CHECK_DELAY_MS = 20_000;

export interface AvailableUpdate {
	version: string;
	/** The release notes written for this version, if any. */
	notes: string | null;
	/**
	 * Downloads and installs it; Zara then restarts as the new version. `onProgress`
	 * hears how much has downloaded, as a share from 0 to 1, or null when the size is unknown.
	 */
	install: (onProgress?: (share: number | null) => void) => Promise<void>;
}

/** Asks for the newest version; null when this one is already it. */
export async function findUpdate(): Promise<AvailableUpdate | null> {
	const update = await check();
	if (!update) return null;
	return {
		version: update.version,
		notes: update.body?.trim() ? update.body.trim() : null,
		install: async (onProgress) => {
			let total = 0;
			let received = 0;
			await update.downloadAndInstall((event) => {
				if (event.event === "Started") {
					total = event.data.contentLength ?? 0;
					onProgress?.(total > 0 ? 0 : null);
				} else if (event.event === "Progress") {
					received += event.data.chunkLength;
					onProgress?.(total > 0 ? Math.min(1, received / total) : null);
				} else {
					onProgress?.(1);
				}
			});
		}
	};
}

/** What went wrong, in words for the user. */
export function describeUpdateError(error: unknown): string {
	const text = String(error instanceof Error ? error.message : error).toLowerCase();
	if (text.includes("signature")) {
		return "The update could not be verified, so it was not installed.";
	}
	if (text.includes("404") || text.includes("not found") || text.includes("valid release json")) {
		return "No update information has been published yet.";
	}
	return "Could not check for updates. Check your internet connection and try again.";
}

export type StartupOfferOutcome =
	| "disabled"
	| "up-to-date"
	| "skipped"
	| "declined"
	| "installing"
	| "failed";

export interface StartupOfferDeps {
	find: () => Promise<AvailableUpdate | null>;
	readSettings: () => Promise<Record<string, string>>;
	saveSetting: (key: string, value: string) => Promise<void>;
	/** Asks the user yes or no with a native dialog; true for yes. */
	ask: (message: string, title: string) => Promise<boolean>;
}

/**
 * The quiet check at startup: unless the user turned it off, look for a newer
 * version and, if there is one they have not already put off, ask whether to
 * install it now. Saying no is remembered for that version only. Any failure
 * (offline, nothing published) is silent: it is not worth interrupting anyone for.
 */
export async function offerUpdateAtStartup(deps: StartupOfferDeps): Promise<StartupOfferOutcome> {
	try {
		const settings = await deps.readSettings();
		if (settings[AUTO_UPDATE_SETTING] === "false") return "disabled";

		const update = await deps.find();
		if (!update) return "up-to-date";
		if (settings[SKIPPED_UPDATE_SETTING] === update.version) return "skipped";

		const notes = update.notes ? `\n\n${update.notes}` : "";
		const install = await deps.ask(
			`Zara ${update.version} is available. Zara restarts to update.${notes}`,
			"Update Zara"
		);
		if (!install) {
			await deps.saveSetting(SKIPPED_UPDATE_SETTING, update.version);
			return "declined";
		}
		await update.install();
		return "installing";
	} catch {
		return "failed";
	}
}
