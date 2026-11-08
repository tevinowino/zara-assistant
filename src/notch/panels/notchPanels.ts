/**
 * The widgets ("panels") the notch can show, and which of them the user has chosen.
 *
 * Adding a widget is one entry in NOTCH_PANEL_DEFINITIONS (what it is: its id, name, icon
 * and default) and, for a widget drawn by a view of its own, one entry in WIDGET_VIEWS
 * (`../widgets/registry.tsx`: how it is drawn: size, panel, background work). `NotchPanel`,
 * the Settings picker and the notch's width, height and mounting follow from those two.
 * What the user chose is one stored preference, `NOTCH_PANELS_SETTING_KEY`: the enabled
 * widgets in the order the notch cycles through them.
 */

import {
	Calendar,
	ClipboardList,
	CloudSun,
	FileCode,
	Headphones,
	Music,
	SlidersHorizontal,
	Sparkles,
	StickyNote,
	type Glyph
} from "../../icons/glyphs";

/** What a definition says before its id is narrowed to the ids that exist. */
interface NotchPanelDefinitionInput {
	id: string;
	/** The name in the picker and in the notch. */
	label: string;
	/** What it is for, in one line, in the picker. */
	description: string;
	/** The icon in the picker. */
	icon: Glyph;
	/** Whether it is on for someone who has never chosen. */
	defaultEnabled: boolean;
}

/** Every widget, in the order a new user first sees them. */
const DEFINITIONS = [
	{
		id: "ai",
		label: "Assistant",
		description: "Ask Zara questions and get answers in the notch.",
		icon: Sparkles,
		defaultEnabled: true
	},
	{
		id: "calendar",
		label: "Calendar & Timer",
		description: "Browse months and run a countdown timer.",
		icon: Calendar,
		defaultEnabled: true
	},
	{
		id: "command-center",
		label: "Command Center",
		description: "Wi-Fi, Bluetooth, volume, brightness and your favourite apps.",
		icon: SlidersHorizontal,
		defaultEnabled: true
	},
	{
		id: "devices",
		label: "Connected Devices",
		description: "Batteries and audio of the devices you have connected.",
		icon: Headphones,
		defaultEnabled: false
	},
	{
		id: "notes",
		label: "Notes",
		description: "Jot something down and see your latest notes.",
		icon: StickyNote,
		defaultEnabled: false
	},
	{
		id: "clipboard",
		label: "Clipboard History",
		description: "The last things you copied, ready to copy again.",
		icon: ClipboardList,
		defaultEnabled: false
	},
	{
		id: "weather",
		label: "Weather",
		description: "The forecast for the next hours and days.",
		icon: CloudSun,
		defaultEnabled: false
	},
	{
		id: "lyrics",
		label: "Lyrics",
		description:
			"The words of the song that is playing, line by line. Asks lrclib.net for them, sending the song's name.",
		icon: Music,
		defaultEnabled: false
	},
	{
		id: "claude-code",
		label: "Claude Code",
		description:
			"What your Claude Code sessions are doing, with a pill when one needs you or finishes. Connect it in Settings first.",
		icon: FileCode,
		defaultEnabled: false
	}
] as const satisfies readonly NotchPanelDefinitionInput[];

/** The id of every widget; derived from the definitions, so adding one adds its id here. */
export type NotchPanel = (typeof DEFINITIONS)[number]["id"];

export interface NotchPanelDefinition extends NotchPanelDefinitionInput {
	id: NotchPanel;
}

export const NOTCH_PANEL_DEFINITIONS: readonly NotchPanelDefinition[] = DEFINITIONS;

export const NOTCH_PANELS: readonly NotchPanel[] = NOTCH_PANEL_DEFINITIONS.map(
	(definition) => definition.id
);

export const asNotchPanel = (value: unknown): NotchPanel | null =>
	NOTCH_PANELS.includes(value as NotchPanel) ? (value as NotchPanel) : null;

export function notchPanelDefinition(panel: NotchPanel): NotchPanelDefinition {
	const definition = NOTCH_PANEL_DEFINITIONS.find((candidate) => candidate.id === panel);
	if (!definition) throw new Error(`Unknown notch panel: ${panel}`);
	return definition;
}

export const NOTCH_PANELS_SETTING_KEY = "zara-notch-panels";

/** The panel that stays when nothing else is on, so the open notch is never empty. */
const FALLBACK_PANEL: NotchPanel = "command-center";

/** The widgets the user has chosen, in the order the notch cycles through them. */
export interface NotchPanelPreferences {
	enabled: readonly NotchPanel[];
}

/**
 * What the settings said before the widgets became one preference: one on/off setting for
 * each of the first four. `undefined` means that setting was never saved.
 */
export type LegacyPanelFlags = Partial<
	Record<"ai" | "calendar" | "command-center" | "devices", boolean>
>;

export function defaultPanelPreferences(): NotchPanelPreferences {
	return {
		enabled: NOTCH_PANEL_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
			(definition) => definition.id
		)
	};
}

/**
 * Reads the stored preference. If there is none, or it is unreadable, the old per-panel
 * settings decide (and the defaults for anything they never set), so nobody loses the
 * panels they had when the picker arrived. Unknown and repeated widgets are dropped, and
 * there is always at least one widget.
 */
export function parsePanelPreferences(
	stored: unknown,
	legacy: LegacyPanelFlags = {}
): NotchPanelPreferences {
	let candidate: unknown = stored;
	if (typeof stored === "string") {
		try {
			candidate = JSON.parse(stored);
		} catch {
			candidate = null;
		}
	}

	if (Array.isArray(candidate)) {
		const chosen = [...new Set(candidate.map(asNotchPanel))].filter(
			(panel): panel is NotchPanel => panel !== null
		);
		if (chosen.length > 0) return { enabled: chosen };
	}

	const migrated = NOTCH_PANEL_DEFINITIONS.filter((definition) => {
		const flag = (legacy as Record<string, boolean | undefined>)[definition.id];
		return flag ?? definition.defaultEnabled;
	}).map((definition) => definition.id);
	return { enabled: migrated.length > 0 ? migrated : [FALLBACK_PANEL] };
}

export function serializePanelPreferences(preferences: NotchPanelPreferences): string {
	return JSON.stringify(preferences.enabled);
}

export function isPanelEnabled(preferences: NotchPanelPreferences, panel: NotchPanel): boolean {
	return preferences.enabled.includes(panel);
}

/**
 * Turns a widget on (added at the end of the cycle) or off. The last widget on cannot be
 * turned off, so the notch always has something to open.
 */
export function setPanelEnabled(
	preferences: NotchPanelPreferences,
	panel: NotchPanel,
	enabled: boolean
): NotchPanelPreferences {
	const already = isPanelEnabled(preferences, panel);
	if (enabled === already) return preferences;
	if (enabled) return { enabled: [...preferences.enabled, panel] };
	if (preferences.enabled.length <= 1) return preferences;
	return { enabled: preferences.enabled.filter((candidate) => candidate !== panel) };
}

/** Moves an enabled widget one place earlier (-1) or later (1) in the cycle. */
export function movePanel(
	preferences: NotchPanelPreferences,
	panel: NotchPanel,
	direction: -1 | 1
): NotchPanelPreferences {
	const from = preferences.enabled.indexOf(panel);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= preferences.enabled.length) return preferences;
	const reordered = [...preferences.enabled];
	[reordered[from], reordered[to]] = [reordered[to], reordered[from]];
	return { enabled: reordered };
}

/**
 * Reads the old one-setting-per-panel flags through `read` (a settings lookup that returns
 * null when a key was never saved), for a user who has not yet made a widget choice.
 */
export function readLegacyPanelFlags(
	read: (key: string) => string | null | undefined
): LegacyPanelFlags {
	const flag = (key: string, onUnlessFalse: boolean): boolean | undefined => {
		const value = read(key);
		if (value === null || value === undefined) return undefined;
		return onUnlessFalse ? value !== "false" : value === "true";
	};
	return {
		ai: flag("zara-notch-ai-enabled", true),
		calendar: flag("zara-calendar-enabled", true),
		"command-center": flag("zara-notch-command-center-enabled", true),
		devices: flag("zara-notch-devices-enabled", false)
	};
}
