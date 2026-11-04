import type { ControlInfo, TuningValues } from "../providers";

/**
 * The "Fast" preset: answers that come sooner because the model thinks less. The
 * backend says, for each setting of a model, the value that turns it down (see
 * `fast` in src-tauri/src/ai/tuning.rs); the preset is those values together.
 * Settings with no such value, such as temperature, are never touched by it.
 */

/** What the preset sets, by setting id. Empty when the model has nothing to turn down. */
export function fastSettings(controls: ControlInfo[]): TuningValues {
	const settings: TuningValues = {};
	for (const control of controls) {
		if (control.fast !== null) settings[control.id] = control.fast;
	}
	return settings;
}

/** Whether every setting the preset sets is at its fast value. False when there is no preset. */
export function isFast(controls: ControlInfo[], values: TuningValues): boolean {
	const fast = fastSettings(controls);
	const ids = Object.keys(fast);
	return ids.length > 0 && ids.every((id) => values[id] === fast[id]);
}

/**
 * `values` with the preset turned on, or off. Turning it off takes only the
 * preset's own settings back to their defaults; everything else the user set stays.
 */
export function withFast(controls: ControlInfo[], values: TuningValues, on: boolean): TuningValues {
	const fast = fastSettings(controls);
	if (on) return { ...values, ...fast };
	const next = { ...values };
	for (const id of Object.keys(fast)) delete next[id];
	return next;
}
