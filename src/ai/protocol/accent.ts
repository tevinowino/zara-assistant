import { z } from "zod";

// The colours generative UI may use. A model names a colour (green, amber, ...)
// instead of writing one, so every colour on screen is one we chose to look right
// on both a dark and a light notch: mid-tones that keep their contrast on either.
// Charts and carousel cards also accept a 6-digit hex, which is checked before it
// is ever drawn.

export const ACCENT_HEX = {
	blue: "#3b82f6",
	green: "#22c55e",
	amber: "#f59e0b",
	red: "#ef4444",
	purple: "#a855f7",
	teal: "#14b8a6",
	pink: "#ec4899",
	slate: "#94a3b8"
} as const;

export type AccentName = keyof typeof ACCENT_HEX;

export const ACCENT_NAMES = [
	"blue",
	"green",
	"amber",
	"red",
	"purple",
	"teal",
	"pink",
	"slate"
] as const satisfies readonly AccentName[];

export const accentSchema = z.enum(ACCENT_NAMES);

/** Colours a chart or a carousel card may use: a named accent or a 6-digit hex. */
export const colorChoiceSchema = z.union([
	accentSchema,
	z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be an accent name or a 6-digit hex color")
]);

/** The order series and pie slices take colours in when the model chose none. */
export const SERIES_ACCENT_ORDER: readonly AccentName[] = [
	"blue",
	"green",
	"amber",
	"purple",
	"teal",
	"pink",
	"red",
	"slate"
];

function isAccentName(value: string): value is AccentName {
	return Object.prototype.hasOwnProperty.call(ACCENT_HEX, value);
}

/** The hex colour for an accent name or a 6-digit hex; undefined for anything else. */
export function resolveColor(choice: string | undefined): string | undefined {
	if (choice === undefined) return undefined;
	if (isAccentName(choice)) return ACCENT_HEX[choice];
	return /^#[0-9a-fA-F]{6}$/.test(choice) ? choice : undefined;
}
