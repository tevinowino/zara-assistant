import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * How long the notch waits after it starts wanting keyboard focus before it
 * asks for it, in milliseconds. Taking focus activates the window, which makes
 * the system and the previous app do work; doing it in the first frame of the
 * notch growing makes that animation stutter. This is long enough for the
 * growth to be under way and short enough that a person who opens the
 * assistant and starts typing is not typing into the previous app.
 */
export const KEYBOARD_FOCUS_DELAY_MS = 150;

/**
 * Holds the notch's keyboard focus while `wanted` is true, taking it
 * `KEYBOARD_FOCUS_DELAY_MS` after `wanted` becomes true and giving it back to
 * the app the user came from when `wanted` becomes false or the notch goes
 * away. A request that ends before the delay passes never reaches the
 * backend, in either direction. Does nothing while `enabled` is false.
 */
export function useDeferredKeyboardFocus(wanted: boolean, enabled: boolean): void {
	useEffect(() => {
		if (!enabled || !wanted) return;
		let taken = false;
		const timer = setTimeout(() => {
			taken = true;
			invoke("ai_take_focus").catch(() => {});
		}, KEYBOARD_FOCUS_DELAY_MS);
		return () => {
			clearTimeout(timer);
			if (taken) invoke("ai_release_focus").catch(() => {});
		};
	}, [wanted, enabled]);
}
