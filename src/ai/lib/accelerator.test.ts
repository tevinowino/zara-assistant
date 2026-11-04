import { describe, expect, it } from "vitest";
import { acceleratorParts, keyboardEventToAccelerator, type KeyPress } from "./accelerator";

function press(code: string, modifiers: Partial<Omit<KeyPress, "code">> = {}): KeyPress {
	return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

describe("keyboardEventToAccelerator", () => {
	it("writes modifiers in the fixed order Ctrl, Alt, Shift, Win whatever order they were pressed", () => {
		const all = press("KeyK", { shiftKey: true, metaKey: true, altKey: true, ctrlKey: true });

		expect(keyboardEventToAccelerator(all)).toBe("Ctrl+Alt+Shift+Win+K");
	});

	it("uses the physical key, so the same key gives the same shortcut on any layout", () => {
		expect(keyboardEventToAccelerator(press("KeyQ", { ctrlKey: true }))).toBe("Ctrl+Q");
		expect(keyboardEventToAccelerator(press("Digit7", { altKey: true }))).toBe("Alt+7");
	});

	it("names special keys the way the backend expects", () => {
		expect(keyboardEventToAccelerator(press("Space", { ctrlKey: true, shiftKey: true }))).toBe(
			"Ctrl+Shift+Space"
		);
		expect(keyboardEventToAccelerator(press("ArrowUp", { ctrlKey: true }))).toBe("Ctrl+Up");
		expect(keyboardEventToAccelerator(press("NumpadEnter", { ctrlKey: true }))).toBe("Ctrl+Enter");
		expect(keyboardEventToAccelerator(press("Comma", { ctrlKey: true }))).toBe("Ctrl+Comma");
		expect(keyboardEventToAccelerator(press("Escape"))).toBe("Escape");
	});

	it("accepts function keys with or without modifiers", () => {
		expect(keyboardEventToAccelerator(press("F9"))).toBe("F9");
		expect(keyboardEventToAccelerator(press("F12", { ctrlKey: true }))).toBe("Ctrl+F12");
		expect(keyboardEventToAccelerator(press("F24"))).toBe("F24");
	});

	it("returns null while only modifier keys are held", () => {
		expect(keyboardEventToAccelerator(press("ControlLeft", { ctrlKey: true }))).toBeNull();
		expect(keyboardEventToAccelerator(press("ShiftRight", { shiftKey: true }))).toBeNull();
		expect(keyboardEventToAccelerator(press("MetaLeft", { metaKey: true }))).toBeNull();
		expect(keyboardEventToAccelerator(press("AltLeft", { altKey: true }))).toBeNull();
	});

	it("returns null for keys that cannot be part of a shortcut", () => {
		expect(keyboardEventToAccelerator(press("F25"))).toBeNull();
		expect(keyboardEventToAccelerator(press("CapsLock"))).toBeNull();
		expect(keyboardEventToAccelerator(press("AudioVolumeUp"))).toBeNull();
	});
});

describe("acceleratorParts", () => {
	it("splits a shortcut into its key caps", () => {
		expect(acceleratorParts("Ctrl+Shift+Space")).toEqual(["Ctrl", "Shift", "Space"]);
		expect(acceleratorParts("F9")).toEqual(["F9"]);
	});
});
