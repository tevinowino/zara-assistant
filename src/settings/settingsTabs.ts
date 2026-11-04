import { BookOpen, Info, Layers, PanelTop, Palette, Settings, Sparkles, type Glyph } from "../icons/glyphs";
import type { SettingsTab } from "./types";

/**
 * The colour of a section's icon tile, after the system colours in Apple's Settings. It
 * colours the sidebar entry and the icons of the rows on that section's page, so a glance
 * tells you where you are.
 */
export type SettingsTone = "gray" | "purple" | "blue" | "pink" | "orange" | "teal";

/** Where the sidebar lists a section: the main sections first, the rest under "Other". */
export type SettingsTabGroup = "main" | "other";

export interface SettingsTabDefinition {
	id: SettingsTab;
	label: string;
	group: SettingsTabGroup;
	/** Words, besides its label, that the sidebar's search matches to this section. */
	keywords: readonly string[];
	icon: Glyph;
	tone: SettingsTone;
	/** One line under the page title saying what the section is for. */
	description: string;
}

/** The sections of the settings window, in the order the sidebar lists them. */
export const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
	{
		id: "general",
		label: "General",
		group: "main",
		keywords: ["startup", "launch", "login", "24-hour", "time", "battery", "reset", "restart", "quit"],
		icon: Settings,
		tone: "gray",
		description: "The essentials for how Zara starts and runs."
	},
	{
		id: "appearance",
		label: "Appearance",
		group: "main",
		keywords: ["theme", "dark", "light", "color", "glass", "glow", "frost", "opacity", "font", "scale", "corners"],
		icon: Palette,
		tone: "purple",
		description: "Make every surface feel at home on your desktop."
	},
	{
		id: "notch",
		label: "Notch",
		group: "main",
		keywords: ["widgets", "calendar", "clipboard", "notes", "weather", "apps", "command center", "music", "shelf", "timer", "peek"],
		icon: PanelTop,
		tone: "blue",
		description: "Choose what appears at the top of your screen."
	},
	{
		id: "assistant",
		label: "Assistant",
		group: "main",
		keywords: ["ai", "model", "chat", "stealth", "screen sharing", "privacy", "web search", "api key", "provider"],
		icon: Sparkles,
		tone: "pink",
		description: "Which AI service and model Zara uses, and what Zara can be seen by."
	},
	{
		id: "library",
		label: "Library",
		group: "main",
		keywords: ["notes", "memory", "conversations", "history", "import"],
		icon: BookOpen,
		tone: "orange",
		description: "Your notes, what Zara remembers, and saved conversations."
	},
	{
		id: "overlays",
		label: "Overlays",
		group: "main",
		keywords: ["volume", "brightness", "hud", "edge"],
		icon: Layers,
		tone: "teal",
		description: "Keep quick controls visible only when you need them."
	},
	{
		id: "about",
		label: "About",
		group: "other",
		keywords: ["version", "update", "license", "export", "import", "backup", "credits"],
		icon: Info,
		tone: "gray",
		description: "Version, credits and your settings data."
	}
];

export function settingsTabFor(id: SettingsTab): SettingsTabDefinition {
	const tab = SETTINGS_TABS.find((candidate) => candidate.id === id);
	if (!tab) throw new Error(`Unknown settings section: ${id}`);
	return tab;
}

/**
 * The sections that match what was typed in the sidebar's search: a section matches when its
 * label, description or one of its keywords contains the text, whatever the case. An empty
 * or blank search matches every section, in their usual order.
 */
export function searchSettingsTabs(
	tabs: readonly SettingsTabDefinition[],
	query: string
): SettingsTabDefinition[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...tabs];
	return tabs.filter((tab) =>
		[tab.label, tab.description, ...tab.keywords].some((text) => text.toLowerCase().includes(needle))
	);
}
