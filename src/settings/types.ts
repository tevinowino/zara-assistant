import type { Glyph } from "../icons/glyphs";

export interface WidgetConfig {
	left: string[];
	right: string[];
}

export type SettingsTab =
	| "general"
	| "appearance"
	| "notch"
	| "assistant"
	| "library"
	| "overlays"
	| "about";

export interface SettingRowProps {
	icon: Glyph;
	label: string;
	desc?: string;
	action?: boolean;
	danger?: boolean;
	divider?: boolean;
	onClick?: () => void;
	children?: React.ReactNode;
}
