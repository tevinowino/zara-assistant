import { describe, expect, it } from "vitest";
import { wantsKeyboardFocus } from "./keyboardFocus";

describe("wantsKeyboardFocus", () => {
	it("holds focus while the assistant panel is open", () => {
		expect(wantsKeyboardFocus({ mode: "ai", isOpen: true, askBarFocused: false })).toBe(true);
	});

	it("holds focus while the Ask Zara bar has the caret in the open calendar panel", () => {
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: true,
				askBarFocused: true
			})
		).toBe(true);
	});

	it("does not hold focus in the calendar panel when the bar is not focused", () => {
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: true,
				askBarFocused: false
			})
		).toBe(false);
	});

	it("ignores a stale focused bar once the notch has moved to another panel", () => {
		expect(
			wantsKeyboardFocus({
				mode: "command-center",
				isOpen: true,
				askBarFocused: true
			})
		).toBe(false);
	});

	it("lets go when the notch is collapsed, even on the assistant", () => {
		expect(wantsKeyboardFocus({ mode: "ai", isOpen: false, askBarFocused: false })).toBe(false);
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: false,
				askBarFocused: true
			})
		).toBe(false);
	});
});
