import { hexToRgba } from "../../lib/color";
import { ACCENT_HEX, SERIES_ACCENT_ORDER, resolveColor } from "../../protocol/accent";

/**
 * The colours charts are drawn in. Series and slices use the accent palette, so a
 * chart is easy to read at a glance; everything that is not data (labels, grid
 * lines, axes, tooltip) is a tint of the notch's own text colour, so it reads in
 * both the dark and the light theme.
 */
export interface ChartPalette {
	/** One fill or stroke per series (or per pie slice). */
	series: string[];
	tick: string;
	grid: string;
	axisLine: string;
	tooltipBackground: string;
	tooltipBorder: string;
	cursorFill: string;
}

const FALLBACK_INK = "#ffffff";

/**
 * `ink` is the theme's text colour as a 6-digit hex (what theme.ts writes);
 * anything else falls back to white. `chosen` are colours the model asked for, by
 * series position: an accent name or a hex. A missing or unrecognised one falls
 * back to the next default accent, so a bad colour never breaks a chart.
 */
export function chartPaletteFor(
	ink: string,
	notchBackground: string,
	chosen: readonly (string | undefined)[] = []
): ChartPalette {
	const color = /^#[0-9a-fA-F]{6}$/.test(ink.trim()) ? ink.trim() : FALLBACK_INK;
	const series = SERIES_ACCENT_ORDER.map(
		(accent, index) => resolveColor(chosen[index]) ?? ACCENT_HEX[accent]
	);
	return {
		series,
		tick: hexToRgba(color, 0.55),
		grid: hexToRgba(color, 0.06),
		axisLine: hexToRgba(color, 0.1),
		tooltipBackground: notchBackground,
		tooltipBorder: hexToRgba(color, 0.14),
		cursorFill: hexToRgba(color, 0.05)
	};
}

/** Reads the live theme, so a chart follows the user's light or dark choice. */
export function currentChartPalette(chosen: readonly (string | undefined)[] = []): ChartPalette {
	const style = getComputedStyle(document.documentElement);
	const ink = style.getPropertyValue("--zara-text");
	const background = style.getPropertyValue("--zara-bg-expanded").trim() || "rgba(0, 0, 0, 0.95)";
	return chartPaletteFor(ink, background, chosen);
}
