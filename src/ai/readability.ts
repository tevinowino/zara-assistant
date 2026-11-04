// Keeping text readable over the assistant's fading background.
//
// The bottom of the assistant panel fades from solid to transparent (see
// `.zara.fade-bottom` in App.css), so the wallpaper shows through. Light text on
// a half-transparent black background fails to contrast with a bright
// wallpaper. This module holds the fade's numbers and works out how far down the
// panel text can safely go, so the layout can keep text above that line and
// leave the rest to the glass.
//
// It assumes the worst case for the default dark theme: white text over a pure
// white wallpaper. A dark wallpaper is always easier.

/** Fractions of the notch's height; they must match `.zara.fade-bottom` in App.css. */
export const FADE_START = 0.7;
export const FADE_END = 0.99;

/** The notch colour's opacity while it is open (`--zara-bg-expanded`, default theme). */
const EXPANDED_THEME_OPACITY = 0.92;

/** WCAG AA contrast for body text. */
const MINIMUM_CONTRAST = 4.5;

/** How far a message may dissolve from fully readable to gone, in pixels. */
const SOFT_EDGE = 24;

/**
 * How opaque the notch background is at `fractionDown` of its height (0 at the
 * top, 1 at the bottom): the theme opacity down to where the fade starts, then
 * a straight line to nothing where it ends.
 */
export function backgroundOpacityAt(fractionDown: number): number {
	if (fractionDown <= FADE_START) return EXPANDED_THEME_OPACITY;
	if (fractionDown >= FADE_END) return 0;
	const remaining = (FADE_END - fractionDown) / (FADE_END - FADE_START);
	return EXPANDED_THEME_OPACITY * remaining;
}

function relativeLuminance(grey: number): number {
	const channel = grey / 255;
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * The contrast ratio of white text over a pure white wallpaper seen through a
 * black background of the given opacity.
 */
export function contrastOfWhiteTextOverWhiteWallpaper(backgroundOpacity: number): number {
	const backdropLuminance = relativeLuminance(255 * (1 - backgroundOpacity));
	return 1.05 / (backdropLuminance + 0.05);
}

/** The largest fraction of the notch's height at which that contrast is still AA. */
function findReadableLimit(): number {
	let readable = FADE_START;
	let unreadable = FADE_END;
	for (let step = 0; step < 40; step += 1) {
		const middle = (readable + unreadable) / 2;
		const contrast = contrastOfWhiteTextOverWhiteWallpaper(backgroundOpacityAt(middle));
		if (contrast >= MINIMUM_CONTRAST) readable = middle;
		else unreadable = middle;
	}
	return readable;
}

/**
 * How far down the notch (as a fraction of its height) text keeps AA contrast
 * even over a white wallpaper. About 0.82 with the current fade.
 */
export const READABLE_LIMIT = findReadableLimit();

/**
 * How long, in pixels, the message list should dissolve at its bottom edge so no
 * text is left below the readable limit. A list that already ends above the
 * limit gets a gentle soft edge; one that reaches past it dissolves over the
 * overshoot as well.
 */
export function messageDissolveLength({
	notchHeight,
	belowMessagesHeight
}: {
	/** The notch's whole height. */
	notchHeight: number;
	/** Everything under the message list: the input and the panel's bottom padding. */
	belowMessagesHeight: number;
}): number {
	const messagesEnd = notchHeight - belowMessagesHeight;
	const overshoot = messagesEnd - READABLE_LIMIT * notchHeight;
	return Math.max(SOFT_EDGE, overshoot + SOFT_EDGE);
}
