/**
 * Which Windows notifications the notch shows as a pill, and what the pill says.
 *
 * Notifications carry private messages and login codes, so the rules lean toward showing
 * nothing: the feature is off until the user turns it on, and then no app may show a pill
 * until the user allows that app. Apps that have sent a notification are remembered by name
 * (never their text) so Settings can list them for the user to allow.
 *
 * Alerts from the Claude Code widget use the same pill and the same choice about showing text,
 * but are the user's own sessions, so they need no per-app allowing: they appear when the
 * widget is on and Claude Code is connected, unless the user turned that kind of alert off.
 */

export const NOTIFICATION_SETTING_KEYS = {
	enabled: "zara-notifications-enabled",
	allowedApps: "zara-notifications-apps",
	seenApps: "zara-notifications-seen-apps",
	showText: "zara-notifications-show-text",
	durationMs: "zara-notifications-duration-ms",
	claudeCodeNeedsInput: "zara-claude-code-alert-input",
	claudeCodeDone: "zara-claude-code-alert-done"
} as const;

/** An app that has sent a notification since the feature was turned on. */
export interface SeenApp {
	/** The app's identity (its AppUserModelId), which stays the same across notifications. */
	id: string;
	/** The name Windows shows for it. */
	name: string;
}

export interface NotificationPreferences {
	enabled: boolean;
	/** The ids of the apps allowed to show a pill. */
	allowedAppIds: readonly string[];
	seenApps: readonly SeenApp[];
	/** Whether the pill shows the notification's text; off shows only the app's name. */
	showText: boolean;
	/** How long a pill stays, in milliseconds. */
	durationMs: number;
	/** Show a pill when a Claude Code session needs the user. */
	claudeCodeNeedsInput: boolean;
	/** Show a pill when a Claude Code session finishes. */
	claudeCodeDone: boolean;
}

export const DEFAULT_NOTIFICATION_DURATION_MS = 5000;
export const MIN_NOTIFICATION_DURATION_MS = 2000;
export const MAX_NOTIFICATION_DURATION_MS = 15000;
/** How many apps are remembered for the Settings list; the least recently seen are forgotten. */
const MAX_SEEN_APPS = 40;

function parseJsonArray(stored: string | null | undefined): unknown[] {
	if (!stored) return [];
	try {
		const parsed: unknown = JSON.parse(stored);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function parseDuration(stored: string | null | undefined): number {
	const value = Number(stored);
	if (!stored || !Number.isFinite(value)) return DEFAULT_NOTIFICATION_DURATION_MS;
	return Math.min(MAX_NOTIFICATION_DURATION_MS, Math.max(MIN_NOTIFICATION_DURATION_MS, value));
}

/**
 * Reads the preferences through `read`, a lookup that returns null (or undefined) for a
 * setting that was never saved. Anything missing or unreadable falls back to the safe
 * choice: the feature is off and no app is allowed. The text is shown unless the user
 * switched that off.
 */
export function parseNotificationPreferences(
	read: (key: string) => string | null | undefined
): NotificationPreferences {
	const allowedAppIds = parseJsonArray(read(NOTIFICATION_SETTING_KEYS.allowedApps)).filter(
		(id): id is string => typeof id === "string" && id.length > 0
	);
	const seenApps = parseJsonArray(read(NOTIFICATION_SETTING_KEYS.seenApps)).filter(
		(app): app is SeenApp =>
			typeof app === "object" &&
			app !== null &&
			typeof (app as SeenApp).id === "string" &&
			typeof (app as SeenApp).name === "string"
	);
	return {
		enabled: read(NOTIFICATION_SETTING_KEYS.enabled) === "true",
		allowedAppIds: [...new Set(allowedAppIds)],
		seenApps: seenApps.slice(0, MAX_SEEN_APPS),
		showText: read(NOTIFICATION_SETTING_KEYS.showText) !== "false",
		durationMs: parseDuration(read(NOTIFICATION_SETTING_KEYS.durationMs)),
		claudeCodeNeedsInput: read(NOTIFICATION_SETTING_KEYS.claudeCodeNeedsInput) !== "false",
		claudeCodeDone: read(NOTIFICATION_SETTING_KEYS.claudeCodeDone) !== "false"
	};
}

/** The apps with `appId` allowed or not; the list stays free of repeats. */
export function withAppAllowed(
	allowedAppIds: readonly string[],
	appId: string,
	allowed: boolean
): string[] {
	const others = allowedAppIds.filter((id) => id !== appId);
	return allowed ? [...others, appId] : others;
}

/** The seen apps with `app` first (it was just seen), keeping the newest few. */
export function withAppSeen(seenApps: readonly SeenApp[], app: SeenApp): SeenApp[] {
	return [app, ...seenApps.filter((seen) => seen.id !== app.id)].slice(0, MAX_SEEN_APPS);
}

/** A notification as the backend sends it. */
export interface IncomingNotification {
	id: number;
	appId: string;
	appName: string;
	title: string;
	body: string;
	appIcon: string | null;
	createdAtMs: number;
}

/** What the pill shows. */
export interface PillNotification {
	id: number;
	appId: string;
	appName: string;
	appIcon: string | null;
	title: string;
	body: string;
}

export interface NotificationDecision {
	/** The pill to show, or null if this notification is not to be shown. */
	pill: PillNotification | null;
	/** An app seen for the first time (or under a new name), to add to the Settings list. */
	newlySeenApp: SeenApp | null;
}

export interface DecisionContext {
	/**
	 * Hide the text whatever the user chose. Used while Stealth is switched on but is not
	 * holding (the notch could be on a shared screen).
	 */
	forceHideText: boolean;
}

/** Hidden-text pills say this instead of the notification's own words. */
export const HIDDEN_TEXT_BODY = "New notification";

export function decideNotification(
	incoming: IncomingNotification,
	preferences: NotificationPreferences,
	{ forceHideText }: DecisionContext
): NotificationDecision {
	if (!preferences.enabled) return { pill: null, newlySeenApp: null };

	const known = preferences.seenApps.find((app) => app.id === incoming.appId);
	const newlySeenApp =
		known && known.name === incoming.appName
			? null
			: { id: incoming.appId, name: incoming.appName };

	if (!preferences.allowedAppIds.includes(incoming.appId)) return { pill: null, newlySeenApp };

	const hideText = forceHideText || !preferences.showText;
	return {
		newlySeenApp,
		pill: {
			id: incoming.id,
			appId: incoming.appId,
			appName: incoming.appName,
			appIcon: incoming.appIcon,
			title: hideText ? incoming.appName : incoming.title,
			body: hideText ? HIDDEN_TEXT_BODY : incoming.body
		}
	};
}

/** A Claude Code session needing the user, or finishing, as the backend sends it. */
export interface ClaudeCodeAlert {
	kind: "needsInput" | "done";
	sessionId: string;
	/** The project's folder name. */
	project: string;
	/** What Claude said, cut short; null if it said nothing. */
	excerpt: string | null;
}

export const CLAUDE_CODE_APP_ID = "claude-code";
export const CLAUDE_CODE_APP_NAME = "Claude Code";

/**
 * The pill for a Claude Code alert, or null if the user turned that kind of alert off. It
 * names the project and says what happened; the text is what Claude said. With the text
 * hidden it says only what happened ("Needs your input", "Finished"), not which project or
 * what was said. `id` must differ from every other pill's.
 */
export function decideClaudeCodeAlert(
	alert: ClaudeCodeAlert,
	preferences: NotificationPreferences,
	{ forceHideText }: DecisionContext,
	id: number
): PillNotification | null {
	const wanted =
		alert.kind === "needsInput" ? preferences.claudeCodeNeedsInput : preferences.claudeCodeDone;
	if (!wanted) return null;

	const hideText = forceHideText || !preferences.showText;
	const happened = alert.kind === "needsInput" ? "needs you" : "finished";
	return {
		id,
		appId: CLAUDE_CODE_APP_ID,
		appName: CLAUDE_CODE_APP_NAME,
		appIcon: null,
		title: hideText
			? alert.kind === "needsInput"
				? "Needs your input"
				: "Finished"
			: `${alert.project} ${happened}`,
		body: hideText ? "" : (alert.excerpt ?? "")
	};
}
