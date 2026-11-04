import type { ZaraMode } from "./types";

export interface KeyboardFocusContext {
	mode: ZaraMode;
	isOpen: boolean;
	/** True while a text field in the open panel (the Ask Zara bar, a note) has the caret. */
	fieldFocused: boolean;
}

/**
 * Whether the notch window should hold keyboard focus right now.
 *
 * The notch is a non-activating window, so it only takes focus from the app the
 * user is working in while something in it needs typing: the assistant panel,
 * or a text field such as the Ask Zara bar or a note. The same answer also decides whether the notch stays
 * pinned open instead of collapsing when the pointer leaves it.
 *
 * `fieldFocused` only counts while a panel that has a text field is open, so a stale
 * value left behind by a panel switch cannot keep the window focused.
 */
export function wantsKeyboardFocus({ mode, isOpen, fieldFocused }: KeyboardFocusContext): boolean {
	if (!isOpen) return false;
	if (mode === "ai") return true;
	return (mode === "calendar" || mode === "notes") && fieldFocused;
}
