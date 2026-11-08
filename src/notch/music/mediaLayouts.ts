/**
 * The looks the open music view can have, and how big the notch is for each.
 *
 * What the user chose is one stored setting, `MEDIA_LAYOUT_SETTING_KEY`. The notch, the
 * Settings window and its live preview all read the layout and its size from here, so a new
 * layout is one entry below and nowhere else.
 */

export const MEDIA_LAYOUTS = ["classic", "compact", "card"] as const;

export type MediaLayout = (typeof MEDIA_LAYOUTS)[number];

export const MEDIA_LAYOUT_SETTING_KEY = "zara-media-layout";

export const DEFAULT_MEDIA_LAYOUT: MediaLayout = "classic";

/** The layout a stored value names; anything unknown or missing is the default. */
export function parseMediaLayout(stored: unknown): MediaLayout {
	return MEDIA_LAYOUTS.includes(stored as MediaLayout)
		? (stored as MediaLayout)
		: DEFAULT_MEDIA_LAYOUT;
}

export interface MediaLayoutSizeOptions {
	layout: MediaLayout;
	/** The track has a known length, so the layout shows a progress bar. */
	hasProgressBar: boolean;
	/** The compact layout's volume slider is open. */
	volumeExpanded: boolean;
}

/** Size of the notch while it shows the open music view, in pixels. */
export interface MediaLayoutSize {
	widthPx: number;
	heightPx: number;
}

/** The card is a near-square: the album cover with the controls on it. */
export const MEDIA_CARD_SIZE: MediaLayoutSize = { widthPx: 316, heightPx: 336 };

export function mediaLayoutSize({
	layout,
	hasProgressBar,
	volumeExpanded
}: MediaLayoutSizeOptions): MediaLayoutSize {
	switch (layout) {
		case "compact":
			return {
				widthPx: 300,
				heightPx: (hasProgressBar ? 132 : 116) + (volumeExpanded ? 36 : 0)
			};
		case "card":
			return MEDIA_CARD_SIZE;
		case "classic":
			return { widthPx: 340, heightPx: 120 };
	}
}
