/**
 * How each widget that has a view of its own is drawn in the notch: its size, the component
 * that shows it, and any work it does in the background while it is on.
 *
 * What a widget *is* (id, name, icon, default) lives in `NOTCH_PANEL_DEFINITIONS`. This file
 * holds what only the notch needs, so the Settings window never loads the views. To add a
 * widget: add its definition, then one entry in `WIDGET_VIEWS`. The notch's width, height,
 * mounting and background work follow from the entry; `App.tsx` is not edited.
 *
 * The assistant, calendar, Command Center and Connected devices widgets are not here: they
 * are drawn by the notch itself because they share its state (the session, the timer, the
 * Bluetooth list).
 */

import type { ComponentType } from "react";
import { isPanelEnabled, type NotchPanel, type NotchPanelPreferences } from "../panels/notchPanels";
import { useClipboardMonitor } from "../clipboard/useClipboardHistory";
import type { ZaraMode } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useCardWantsLyrics } from "../lyrics/lyricsStore";
import { useTrackLyrics } from "../lyrics/useTrackLyrics";
import type { MediaSnapshot } from "../lyrics/lyricsTypes";
import {
	ClaudeCodePanel,
	CLAUDE_CODE_PANEL_HEIGHT_PX,
	CLAUDE_CODE_PANEL_WIDTH_PX
} from "../views/ClaudeCodePanel";
import { LyricsPanel, LYRICS_PANEL_HEIGHT_PX, LYRICS_PANEL_WIDTH_PX } from "../views/LyricsPanel";
import {
	ClipboardPanel,
	CLIPBOARD_PANEL_HEIGHT_PX,
	CLIPBOARD_PANEL_WIDTH_PX
} from "../views/ClipboardPanel";
import { NotesPanel, NOTES_PANEL_HEIGHT_PX, NOTES_PANEL_WIDTH_PX } from "../views/NotesPanel";
import {
	WeatherPanel,
	WEATHER_PANEL_HEIGHT_PX,
	WEATHER_PANEL_WIDTH_PX
} from "../views/WeatherPanel";

/** What the notch hands every widget view; a view takes the parts it needs. */
export interface WidgetPanelProps {
	/** The view the notch is showing; a widget draws itself only while this is its own. */
	zaraMode: ZaraMode;
	/**
	 * Called when a text field in the widget gains or loses the caret, so the notch can take
	 * and give back keyboard focus.
	 */
	onFieldFocusChange: (focused: boolean) => void;
	/** Whether hours are shown on a 24-hour clock. */
	timeFormat24h: boolean;
	/** What is playing. */
	media: MediaSnapshot;
	/** Sends a question to the assistant and opens it. */
	askZara: (question: string) => void;
}

export interface WidgetBackgroundProps {
	/** Whether the widget is on, in the notch window. Work must stop when this is false. */
	enabled: boolean;
	/** What is playing. */
	media: MediaSnapshot;
}

export interface NotchWidgetView {
	/** Size of the notch while it shows the widget, including its 36px top row. */
	widthPx: number;
	heightPx: number;
	/** The widget's content, drawn while the notch shows it. */
	Panel: ComponentType<WidgetPanelProps>;
	/**
	 * Work the widget does whether or not it is on screen (watching the clipboard, following a
	 * feed). Always mounted; it must do nothing while `enabled` is false.
	 */
	Background?: ComponentType<WidgetBackgroundProps>;
}

function ClipboardBackground({ enabled }: WidgetBackgroundProps) {
	useClipboardMonitor(enabled);
	return null;
}

function ClaudeCodeBackground({ enabled }: WidgetBackgroundProps) {
	useEffect(() => {
		invoke("claude_code_enable", { enabled }).catch(() => {});
	}, [enabled]);
	return null;
}

/**
 * Fetches lyrics while the Lyrics widget is on, and also while the music card is open with its
 * lyrics button on (the card says so through the lyrics store).
 */
function LyricsBackground({ enabled, media }: WidgetBackgroundProps) {
	const cardWantsLyrics = useCardWantsLyrics();
	useTrackLyrics(enabled || cardWantsLyrics, media);
	return null;
}

export const WIDGET_VIEWS: Partial<Record<NotchPanel, NotchWidgetView>> = {
	notes: {
		widthPx: NOTES_PANEL_WIDTH_PX,
		heightPx: NOTES_PANEL_HEIGHT_PX,
		Panel: NotesPanel
	},
	clipboard: {
		widthPx: CLIPBOARD_PANEL_WIDTH_PX,
		heightPx: CLIPBOARD_PANEL_HEIGHT_PX,
		Panel: ClipboardPanel,
		Background: ClipboardBackground
	},
	weather: {
		widthPx: WEATHER_PANEL_WIDTH_PX,
		heightPx: WEATHER_PANEL_HEIGHT_PX,
		Panel: WeatherPanel
	},
	lyrics: {
		widthPx: LYRICS_PANEL_WIDTH_PX,
		heightPx: LYRICS_PANEL_HEIGHT_PX,
		Panel: LyricsPanel,
		Background: LyricsBackground
	},
	"claude-code": {
		widthPx: CLAUDE_CODE_PANEL_WIDTH_PX,
		heightPx: CLAUDE_CODE_PANEL_HEIGHT_PX,
		Panel: ClaudeCodePanel,
		Background: ClaudeCodeBackground
	}
};

/** The widgets that have a view here, as [id, view] pairs. */
const WIDGET_VIEW_ENTRIES = Object.entries(WIDGET_VIEWS) as [NotchPanel, NotchWidgetView][];

/** The size of the notch for `mode`, if `mode` is a widget with a view here. */
export function widgetViewSize(mode: ZaraMode): { widthPx: number; heightPx: number } | null {
	const view = WIDGET_VIEWS[mode as NotchPanel];
	return view ? { widthPx: view.widthPx, heightPx: view.heightPx } : null;
}

/** Every widget view; each draws itself only while the notch shows it. */
export function WidgetPanels(props: WidgetPanelProps) {
	return (
		<>
			{WIDGET_VIEW_ENTRIES.map(([panel, { Panel }]) => (
				<Panel key={panel} {...props} />
			))}
		</>
	);
}

export interface WidgetBackgroundsProps {
	/** The widgets the user has turned on. */
	preferences: NotchPanelPreferences;
	/** False in every window but the notch itself, where no widget may work in the background. */
	active: boolean;
	/** What is playing. */
	media: MediaSnapshot;
}

/** The background work of every widget that has some, running only for the ones that are on. */
export function WidgetBackgrounds({ preferences, active, media }: WidgetBackgroundsProps) {
	return (
		<>
			{WIDGET_VIEW_ENTRIES.map(([panel, { Background }]) =>
				Background ? (
					<Background
						key={panel}
						enabled={active && isPanelEnabled(preferences, panel)}
						media={media}
					/>
				) : null
			)}
		</>
	);
}
