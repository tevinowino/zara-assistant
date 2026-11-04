/**
 * Heights, in CSS pixels, the notch gives the assistant panel. Kept in its own
 * tiny module so the notch can size itself without loading the panel (and the
 * markdown, chart and diagram libraries behind it) up front.
 *
 * `welcome` fits the greeting, the suggestions and a few recent chats;
 * `conversation` is the least height for reading an answer or browsing past
 * chats; `max` is the most the panel grows to for a long answer, after which
 * the answer scrolls. The notch window must be at least `max` tall (see
 * NOTCH_WINDOW_HEIGHT in src-tauri/src/utils.rs, checked by panelSize.test.ts).
 */
export const AI_PANEL_HEIGHT = { welcome: 296, conversation: 400, max: 600 } as const;

/** Width of the notch while the assistant is open. */
export const AI_PANEL_WIDTH = 580;

/** The notch's own top row (clock and status), which sits above the panel. */
export const NOTCH_TOP_ROW_HEIGHT = 36;

/** Space kept free below the panel inside the notch window. */
const WINDOW_BOTTOM_MARGIN = 16;

/**
 * The height to give the panel when its content wants `wanted`: never more than
 * `max`, never more than fits in the window (`availableHeight`, in the same CSS
 * pixels) with a margin, and never less than the welcome height.
 */
export function fitAiPanelHeight(wanted: number, availableHeight: number): number {
	const ceiling = Math.min(AI_PANEL_HEIGHT.max, availableHeight - WINDOW_BOTTOM_MARGIN);
	return Math.max(AI_PANEL_HEIGHT.welcome, Math.min(wanted, ceiling));
}
