/**
 * The colors of the glow around the music card, picked from the album cover.
 *
 * The glow used to be the cover itself, blown up and blurred, so it showed whatever sat in
 * the middle of the picture. This picks the colors that dominate the cover instead, so a
 * cover that is mostly red and purple glows red and purple.
 *
 * How: every vivid pixel votes for its hue, weighted by how colorful it is. The strongest
 * hues that are far enough apart win, each one averaged from the pixels near it and then
 * lifted into a range that reads as light rather than mud. Black, white, grey and see-through
 * pixels do not vote: they would only dull the glow.
 */

export interface GlowColor {
	/** 0-255 */
	r: number;
	g: number;
	b: number;
	/** This color's share of the glow, 0-1. The shares of a palette add up to 1. */
	weight: number;
}

/** What a cover with no color of its own (black and white, grey) glows. */
export const NEUTRAL_GLOW: readonly GlowColor[] = [{ r: 226, g: 228, b: 240, weight: 1 }];

const MAX_COLORS = 3;
/** Two glow colors must differ in hue by at least this many degrees. */
const MIN_HUE_SEPARATION_DEG = 30;
/** Pixels darker or lighter than this (HSL lightness, 0-1) do not vote. */
const MIN_VOTING_LIGHTNESS = 0.12;
const MAX_VOTING_LIGHTNESS = 0.92;
/** Pixels at least this see-through (alpha 0-255) do not vote. */
const MIN_VOTING_ALPHA = 128;
/** A cover whose voting pixels are on average less colorful than this (0-1) has no color. */
const MIN_AVERAGE_CHROMA = 0.08;
/** A hue with less than this share of all the votes is dropped. */
const MIN_VOTE_SHARE = 0.12;
const HUE_BIN_DEG = 10;
const HUE_BINS = 360 / HUE_BIN_DEG;
/** A glow color is lifted into these ranges so it reads as light (HSL, 0-1). */
const GLOW_SATURATION = { min: 0.6, max: 0.95 };
const GLOW_LIGHTNESS = { min: 0.5, max: 0.62 };

interface Hsl {
	h: number;
	s: number;
	l: number;
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const delta = max - min;
	if (delta === 0) return { h: 0, s: 0, l };
	const s = delta / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === rn) h = ((gn - bn) / delta) % 6;
	else if (max === gn) h = (bn - rn) / delta + 2;
	else h = (rn - gn) / delta + 4;
	h *= 60;
	if (h < 0) h += 360;
	return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): { r: number; g: number; b: number } {
	const chroma = (1 - Math.abs(2 * l - 1)) * s;
	const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - chroma / 2;
	const [r1, g1, b1] =
		h < 60
			? [chroma, x, 0]
			: h < 120
				? [x, chroma, 0]
				: h < 180
					? [0, chroma, x]
					: h < 240
						? [0, x, chroma]
						: h < 300
							? [x, 0, chroma]
							: [chroma, 0, x];
	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255)
	};
}

/** How far apart two hues are on the color wheel, 0-180 degrees. */
function hueDistance(a: number, b: number): number {
	const apart = Math.abs(a - b) % 360;
	return apart > 180 ? 360 - apart : apart;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface Vote {
	r: number;
	g: number;
	b: number;
	hue: number;
	/** How colorful the pixel is, 0-1: what its vote is worth. */
	chroma: number;
}

function votesFrom(pixels: ArrayLike<number>): Vote[] {
	const votes: Vote[] = [];
	for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
		if (pixels[offset + 3] < MIN_VOTING_ALPHA) continue;
		const r = pixels[offset];
		const g = pixels[offset + 1];
		const b = pixels[offset + 2];
		const { h, s, l } = rgbToHsl(r, g, b);
		if (l < MIN_VOTING_LIGHTNESS || l > MAX_VOTING_LIGHTNESS) continue;
		votes.push({ r, g, b, hue: h, chroma: s * (1 - Math.abs(2 * l - 1)) });
	}
	return votes;
}

/** The centers of the strongest hues, strongest first, each far enough from the ones before. */
function strongestHues(votes: Vote[]): number[] {
	const histogram = new Array<number>(HUE_BINS).fill(0);
	for (const vote of votes) {
		histogram[Math.floor(vote.hue / HUE_BIN_DEG) % HUE_BINS] += vote.chroma;
	}
	const total = histogram.reduce((sum, binWeight) => sum + binWeight, 0);
	// A hue's strength counts its neighbours, so a red that straddles two bins is one red.
	const spread = histogram.map(
		(binWeight, bin) =>
			binWeight +
			0.5 * (histogram[(bin + 1) % HUE_BINS] + histogram[(bin + HUE_BINS - 1) % HUE_BINS])
	);

	const centers: number[] = [];
	const taken = new Set<number>();
	while (centers.length < MAX_COLORS) {
		let best = -1;
		for (let bin = 0; bin < HUE_BINS; bin++) {
			if (taken.has(bin)) continue;
			if (best === -1 || spread[bin] > spread[best]) best = bin;
		}
		if (best === -1 || histogram[best] / total < MIN_VOTE_SHARE / 3) break;
		const center = best * HUE_BIN_DEG + HUE_BIN_DEG / 2;
		centers.push(center);
		for (let bin = 0; bin < HUE_BINS; bin++) {
			if (hueDistance(bin * HUE_BIN_DEG + HUE_BIN_DEG / 2, center) < MIN_HUE_SEPARATION_DEG) {
				taken.add(bin);
			}
		}
	}
	return centers;
}

/** Lifts a color into the ranges where a glow reads as light. */
function toGlowColor(r: number, g: number, b: number): { r: number; g: number; b: number } {
	const { h, s, l } = rgbToHsl(r, g, b);
	return hslToRgb({
		h,
		s: clamp(s, GLOW_SATURATION.min, GLOW_SATURATION.max),
		l: clamp(l, GLOW_LIGHTNESS.min, GLOW_LIGHTNESS.max)
	});
}

/**
 * The colors a cover should glow, strongest first, at most three, with shares that add up
 * to 1. `pixels` is the cover's RGBA bytes (as `ImageData.data`), shrunk to a few dozen
 * pixels across: a larger picture only costs time. A cover with no color (or no pixels)
 * gets the neutral glow.
 */
export function extractGlowPalette(pixels: ArrayLike<number>): GlowColor[] {
	const votes = votesFrom(pixels);
	if (votes.length === 0) return [...NEUTRAL_GLOW];
	const averageChroma = votes.reduce((sum, vote) => sum + vote.chroma, 0) / votes.length;
	if (averageChroma < MIN_AVERAGE_CHROMA) return [...NEUTRAL_GLOW];

	const centers = strongestHues(votes);
	const groups = centers.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
	for (const vote of votes) {
		let nearest = -1;
		let nearestDistance = MIN_HUE_SEPARATION_DEG;
		centers.forEach((center, index) => {
			const distance = hueDistance(vote.hue, center);
			if (distance < nearestDistance) {
				nearest = index;
				nearestDistance = distance;
			}
		});
		if (nearest === -1) continue;
		const group = groups[nearest];
		group.r += vote.r * vote.chroma;
		group.g += vote.g * vote.chroma;
		group.b += vote.b * vote.chroma;
		group.weight += vote.chroma;
	}

	const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
	const kept = groups.filter((group) => group.weight / totalWeight >= MIN_VOTE_SHARE);
	if (kept.length === 0) return [...NEUTRAL_GLOW];
	const keptWeight = kept.reduce((sum, group) => sum + group.weight, 0);
	return kept.map((group) => ({
		...toGlowColor(group.r / group.weight, group.g / group.weight, group.b / group.weight),
		weight: group.weight / keptWeight
	}));
}

/** Where on the glow's box each color's light is centered, strongest color first. */
const GLOW_ANCHORS = ["50% 8%", "10% 85%", "92% 70%"] as const;

/**
 * The CSS background of the glow: one soft radial light per color, bigger for a stronger
 * color. Layers are listed strongest first, which CSS paints on top.
 */
export function glowBackground(palette: readonly GlowColor[]): string {
	return palette
		.map(({ r, g, b, weight }, index) => {
			const reach = Math.round(55 + weight * 35);
			const anchor = GLOW_ANCHORS[index % GLOW_ANCHORS.length];
			return `radial-gradient(${reach}% ${reach}% at ${anchor}, rgba(${r}, ${g}, ${b}, 0.9), rgba(${r}, ${g}, ${b}, 0) 72%)`;
		})
		.join(", ");
}
