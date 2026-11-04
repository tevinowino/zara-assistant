/**
 * The favourite apps the user pins to the command center: at most four, in the order they
 * chose. Stored as one JSON setting, `QUICK_APPS_SETTING_KEY`.
 */

export interface QuickApp {
	/** The name shown under the icon and read by assistive technology. */
	name: string;
	/** What opens it: the path of a shortcut or program, which the backend's `open_app` launches. */
	target: string;
}

export const MAX_QUICK_APPS = 4;
export const QUICK_APPS_SETTING_KEY = "zara-quick-apps";

const sameTarget = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Reads the stored list. Anything unreadable, an entry without a name or a target, a
 * repeated app, and anything beyond the fourth app is dropped, so a bad value can never
 * put a broken button in the command center.
 */
export function parseQuickApps(stored: unknown): QuickApp[] {
	let candidate: unknown = stored;
	if (typeof stored === "string") {
		try {
			candidate = JSON.parse(stored);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(candidate)) return [];

	const apps: QuickApp[] = [];
	for (const item of candidate) {
		if (typeof item !== "object" || item === null) continue;
		const { name, target } = item as Record<string, unknown>;
		if (typeof name !== "string" || typeof target !== "string") continue;
		if (name.trim() === "" || target.trim() === "") continue;
		if (apps.some((app) => sameTarget(app.target, target))) continue;
		apps.push({ name: name.trim(), target });
		if (apps.length === MAX_QUICK_APPS) break;
	}
	return apps;
}

export function serializeQuickApps(apps: readonly QuickApp[]): string {
	return JSON.stringify(apps);
}

export function isQuickAppsFull(apps: readonly QuickApp[]): boolean {
	return apps.length >= MAX_QUICK_APPS;
}

export function hasQuickApp(apps: readonly QuickApp[], target: string): boolean {
	return apps.some((app) => sameTarget(app.target, target));
}

/** Adds an app at the end. Unchanged if it is already there or the four places are taken. */
export function addQuickApp(apps: readonly QuickApp[], app: QuickApp): readonly QuickApp[] {
	if (isQuickAppsFull(apps) || hasQuickApp(apps, app.target)) return apps;
	return [...apps, { name: app.name.trim(), target: app.target }];
}

export function removeQuickApp(apps: readonly QuickApp[], target: string): readonly QuickApp[] {
	if (!hasQuickApp(apps, target)) return apps;
	return apps.filter((app) => !sameTarget(app.target, target));
}

/** Moves an app one place earlier (-1) or later (1). */
export function moveQuickApp(
	apps: readonly QuickApp[],
	target: string,
	direction: -1 | 1
): readonly QuickApp[] {
	const from = apps.findIndex((app) => sameTarget(app.target, target));
	const to = from + direction;
	if (from < 0 || to < 0 || to >= apps.length) return apps;
	const reordered = [...apps];
	[reordered[from], reordered[to]] = [reordered[to], reordered[from]];
	return reordered;
}

/** A name for a program the user picked from disk: its file name without the extension. */
export function appNameFromPath(path: string): string {
	const fileName = path.split(/[\\/]/).pop() ?? path;
	const withoutExtension = fileName.replace(/\.[^.]+$/, "");
	return (withoutExtension || fileName).trim();
}
