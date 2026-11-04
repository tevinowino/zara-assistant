import { describe, expect, it } from "vitest";
import { wantsKeyboardFocus } from "./keyboardFocus";

describe("wantsKeyboardFocus", () => {
	it("holds focus while the assistant panel is open", () => {
		expect(wantsKeyboardFocus({ mode: "ai", isOpen: true, fieldFocused: false })).toBe(true);
	});

	it("holds focus while the Ask Zara bar has the caret in the open calendar panel", () => {
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: true,
				fieldFocused: true
			})
		).toBe(true);
	});

	it("does not hold focus in the calendar panel when the bar is not focused", () => {
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: true,
				fieldFocused: false
			})
		).toBe(false);
	});

	it("ignores a stale focused bar once the notch has moved to another panel", () => {
		expect(
			wantsKeyboardFocus({
				mode: "command-center",
				isOpen: true,
				fieldFocused: true
			})
		).toBe(false);
	});

	it("lets go when the notch is collapsed, even on the assistant", () => {
		expect(wantsKeyboardFocus({ mode: "ai", isOpen: false, fieldFocused: false })).toBe(false);
		expect(
			wantsKeyboardFocus({
				mode: "calendar",
				isOpen: false,
				fieldFocused: true
			})
		).toBe(false);
	});
});

describe("wantsKeyboardFocus in the notes panel", () => {
	it("holds focus while a note field has the caret", () => {
		expect(wantsKeyboardFocus({ mode: "notes", isOpen: true, fieldFocused: true })).toBe(true);
	});

	it("does not hold focus in the notes panel when no field has the caret", () => {
		expect(wantsKeyboardFocus({ mode: "notes", isOpen: true, fieldFocused: false })).toBe(false);
	});

	it("lets go when the notch is collapsed", () => {
		expect(wantsKeyboardFocus({ mode: "notes", isOpen: false, fieldFocused: true })).toBe(false);
	});

	it("ignores a stale focused field on a panel with no text field", () => {
		expect(wantsKeyboardFocus({ mode: "clipboard", isOpen: true, fieldFocused: true })).toBe(false);
		expect(wantsKeyboardFocus({ mode: "weather", isOpen: true, fieldFocused: true })).toBe(false);
	});
});
