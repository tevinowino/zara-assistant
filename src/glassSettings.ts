/**
 * The user's Liquid Glass choices for the surfaces that hang from a screen edge (the
 * notch and the volume and brightness overlays).
 *
 * Zara cannot refract the desktop behind its transparent windows, so "glass" here is a
 * material drawn on the surface itself, not a lens: a lit rim, a colour fringe along it,
 * a sheen of light across the top, a milky haze and shading toward the edges. How clear
 * the glass is comes from the theme's Background Opacity, not from here.
 *
 * The whole value travels as one JSON setting (`GLASS_SETTING_KEY`), so adding an option
 * never means touching every layer that carries settings.
 */
export interface GlassSettings {
	enabled: boolean;
	/** Brightness of the lit rim, 0 (none) to 1 (strongest). */
	edgeShine: number;
	/** Strength of the light washing down from the top, 0 to 1. */
	sheen: number;
	/** Rim thickness in CSS pixels, from MIN_EDGE_WIDTH_PX to MAX_EDGE_WIDTH_PX. */
	edgeWidthPx: number;
	/** Milky haze through the glass, 0 (clear) to 1 (frosted). */
	frost: number;
	/** Cool and warm colour fringe along the rim, as light splits at a glass edge, 0 to 1. */
	dispersion: number;
	/** Shading toward the edges that gives the glass thickness, 0 (flat) to 1. */
	depth: number;
}

export const GLASS_SETTING_KEY = "zara-glass";
export const MIN_EDGE_WIDTH_PX = 1;
export const MAX_EDGE_WIDTH_PX = 3;

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
	enabled: false,
	edgeShine: 0.6,
	sheen: 0.5,
	edgeWidthPx: 1.5,
	frost: 0.2,
	dispersion: 0.3,
	depth: 0.4
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function unitInterval(value: unknown, fallback: number): number {
	return clamp(value, 0, 1, fallback);
}

/**
 * Reads a stored glass setting. Anything unreadable (missing, corrupt, from a future
 * version) yields the defaults, and out-of-range numbers are clamped, so a bad value can
 * never leave the notch unreadable.
 */
export function parseGlassSettings(stored: unknown): GlassSettings {
	let raw: unknown = stored;
	if (typeof stored === "string") {
		try {
			raw = JSON.parse(stored);
		} catch {
			return DEFAULT_GLASS_SETTINGS;
		}
	}
	if (typeof raw !== "object" || raw === null) return DEFAULT_GLASS_SETTINGS;
	const fields = raw as Record<string, unknown>;
	return {
		enabled: fields.enabled === true,
		edgeShine: unitInterval(fields.edgeShine, DEFAULT_GLASS_SETTINGS.edgeShine),
		sheen: unitInterval(fields.sheen, DEFAULT_GLASS_SETTINGS.sheen),
		edgeWidthPx: clamp(
			fields.edgeWidthPx,
			MIN_EDGE_WIDTH_PX,
			MAX_EDGE_WIDTH_PX,
			DEFAULT_GLASS_SETTINGS.edgeWidthPx
		),
		frost: unitInterval(fields.frost, DEFAULT_GLASS_SETTINGS.frost),
		dispersion: unitInterval(fields.dispersion, DEFAULT_GLASS_SETTINGS.dispersion),
		depth: unitInterval(fields.depth, DEFAULT_GLASS_SETTINGS.depth)
	};
}

export function serializeGlassSettings(glass: GlassSettings): string {
	return JSON.stringify(glass);
}

/**
 * Makes the page draw (or stop drawing) glass: sets `data-glass` and the `--glass-*`
 * variables that EdgeSurface.css reads.
 */
export function applyGlassSettings(root: HTMLElement, glass: GlassSettings): void {
	root.dataset.glass = glass.enabled ? "on" : "off";
	root.style.setProperty("--glass-shine", String(glass.edgeShine));
	root.style.setProperty("--glass-sheen", String(glass.sheen));
	root.style.setProperty("--glass-edge-width", `${glass.edgeWidthPx}px`);
	root.style.setProperty("--glass-frost", String(glass.frost));
	root.style.setProperty("--glass-dispersion", String(glass.dispersion));
	root.style.setProperty("--glass-depth", String(glass.depth));
}
