import type { ZaraMode } from "./types";

export interface KeyboardFocusContext {
	mode: ZaraMode;
	isOpen: boolean;
	/** True while the Ask Zara bar in the calendar panel has the text caret. */
	askBarFocused: boolean;
}

/**
 * Whether the notch window should hold keyboard focus right now.
 *
 * The notch is a non-activating window, so it only takes focus from the app the
 * user is working in while something in it needs typing: the assistant panel,
 * or the Ask Zara bar. The same answer also decides whether the notch stays
 * pinned open instead of collapsing when the pointer leaves it.
 *
 * `askBarFocused` only counts while the calendar panel is open, so a stale
 * value left behind by a panel switch cannot keep the window focused.
 */
export function wantsKeyboardFocus({ mode, isOpen, askBarFocused }: KeyboardFocusContext): boolean {
	if (!isOpen) return false;
	if (mode === "ai") return true;
	return mode === "calendar" && askBarFocused;
}
