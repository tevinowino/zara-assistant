/**
 * The user's accent glow for surfaces that hang from a screen edge (the notch and the
 * volume and brightness overlays): a soft halo of colour around the surface. It works
 * with or without Liquid Glass.
 *
 * The glow is painted inside the window's clipped region (see windowRegion.ts), which
 * leaves 24px around a surface, so GLOW_REACH_PX stays under that.
 *
 * The whole value travels as one JSON setting (`GLOW_SETTING_KEY`).
 */
export interface GlowSettings {
	enabled: boolean;
	/** A "#rrggbb" colour, or null to follow the theme's accent colour. */
	color: string | null;
	/** How visible the halo is, 0 (invisible) to 1 (strong). */
	intensity: number;
}

export const GLOW_SETTING_KEY = "zara-glow";
/** How far the halo reaches beyond the surface, in CSS pixels. */
export const GLOW_REACH_PX = 20;

export const DEFAULT_GLOW_SETTINGS: GlowSettings = {
	enabled: false,
	color: null,
	intensity: 0.5
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Reads a stored glow setting. Anything unreadable yields the defaults; a colour that is
 * not "#rrggbb" becomes "follow the theme", and the intensity is clamped to 0..1.
 */
export function parseGlowSettings(stored: unknown): GlowSettings {
	let raw: unknown = stored;
	if (typeof stored === "string") {
		try {
			raw = JSON.parse(stored);
		} catch {
			return DEFAULT_GLOW_SETTINGS;
		}
	}
	if (typeof raw !== "object" || raw === null) return DEFAULT_GLOW_SETTINGS;
	const fields = raw as Record<string, unknown>;
	const intensity =
		typeof fields.intensity === "number" && Number.isFinite(fields.intensity)
			? Math.min(1, Math.max(0, fields.intensity))
			: DEFAULT_GLOW_SETTINGS.intensity;
	return {
		enabled: fields.enabled === true,
		color:
			typeof fields.color === "string" && HEX_COLOR.test(fields.color)
				? fields.color.toLowerCase()
				: null,
		intensity
	};
}

export function serializeGlowSettings(glow: GlowSettings): string {
	return JSON.stringify(glow);
}

/**
 * Makes the page draw (or stop drawing) the glow: sets `data-glow` and the `--glow-*`
 * variables that EdgeSurface.css reads. With no chosen colour the halo follows the
 * theme's accent.
 */
export function applyGlowSettings(root: HTMLElement, glow: GlowSettings): void {
	root.dataset.glow = glow.enabled ? "on" : "off";
	root.style.setProperty("--glow-color", glow.color ?? "var(--zara-accent, #007aff)");
	root.style.setProperty("--glow-intensity", String(glow.intensity));
	root.style.setProperty("--glow-reach", `${GLOW_REACH_PX}px`);
}
