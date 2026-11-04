// Turns a key press into the canonical shortcut text the Rust side parses
// ("Ctrl+Shift+Space"), so the settings recorder and the backend always agree.
// Modifiers always come in the order Ctrl, Alt, Shift, Win.

const NAMED_KEYS: Record<string, string> = {
	Space: "Space",
	Enter: "Enter",
	NumpadEnter: "Enter",
	Tab: "Tab",
	Escape: "Escape",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Comma: "Comma",
	Period: "Period",
	Slash: "Slash",
	Backslash: "Backslash",
	Semicolon: "Semicolon",
	Quote: "Quote",
	Minus: "Minus",
	Equal: "Equal",
	BracketLeft: "BracketLeft",
	BracketRight: "BracketRight",
	Backquote: "Backquote"
};

/** The part of a key event this needs; a KeyboardEvent satisfies it. */
export interface KeyPress {
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

// Physical key codes, not the typed character, so a shortcut means the same key
// on every keyboard layout.
function keyFromCode(code: string): string | null {
	const letter = /^Key([A-Z])$/.exec(code);
	if (letter) return letter[1];
	const digit = /^Digit(\d)$/.exec(code);
	if (digit) return digit[1];
	const fn = /^F(\d{1,2})$/.exec(code);
	if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24) return `F${fn[1]}`;
	return NAMED_KEYS[code] ?? null;
}

/** The shortcut text for a key press, or null while only modifier keys are held. */
export function keyboardEventToAccelerator(press: KeyPress): string | null {
	const key = keyFromCode(press.code);
	if (!key) return null;
	const parts: string[] = [];
	if (press.ctrlKey) parts.push("Ctrl");
	if (press.altKey) parts.push("Alt");
	if (press.shiftKey) parts.push("Shift");
	if (press.metaKey) parts.push("Win");
	parts.push(key);
	return parts.join("+");
}

/** The parts of a shortcut for showing as separate key caps. */
export function acceleratorParts(accelerator: string): string[] {
	return accelerator.split("+");
}
