import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * How much room the settings window has, as the layout sees it:
 * - compact: the sections become a strip across the top and rows stack;
 * - regular: the sidebar beside a single column;
 * - wide: the live preview moves into its own column beside the settings.
 */
export type SettingsWidth = "compact" | "regular" | "wide";

/** Below this many CSS pixels of window width the layout is compact. */
export const COMPACT_BELOW_PX = 720;
/** From this many CSS pixels the layout is wide. */
export const WIDE_FROM_PX = 1100;

/** The size the settings window opens at, in CSS pixels at 100% scale. */
export const SETTINGS_WINDOW_BASE_SIZE = { width: 900, height: 640 } as const;

/** The layout for a window `effectiveWidthPx` wide, after taking the UI scale out. */
export function settingsWidthFor(effectiveWidthPx: number): SettingsWidth {
	if (effectiveWidthPx < COMPACT_BELOW_PX) return "compact";
	if (effectiveWidthPx < WIDE_FROM_PX) return "regular";
	return "wide";
}

/**
 * Tracks the window's width, so the layout can adapt as the user resizes it. The UI scale
 * zooms everything, so a 900px window at 130% has only about 690px to lay out.
 */
export function useSettingsWidth(scale: number): SettingsWidth {
	const [width, setWidth] = useState(() => settingsWidthFor(window.innerWidth / scale));

	useEffect(() => {
		const update = () => setWidth(settingsWidthFor(window.innerWidth / scale));
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, [scale]);

	return width;
}

/**
 * Sizes the window for the UI scale. The window opens at its configured size, so at 100%
 * nothing is done on opening, and the user's own resizing is never undone; a scale other
 * than 100% resizes it to match, on opening and whenever the scale changes.
 */
export function useSettingsWindowSize(scale: number): void {
	const isFirstRun = useRef(true);

	useEffect(() => {
		const firstRun = isFirstRun.current;
		isFirstRun.current = false;
		if (firstRun && scale === 1) return;
		invoke("resize_settings_window", {
			width: SETTINGS_WINDOW_BASE_SIZE.width * scale,
			height: SETTINGS_WINDOW_BASE_SIZE.height * scale
		}).catch(console.error);
	}, [scale]);
}
