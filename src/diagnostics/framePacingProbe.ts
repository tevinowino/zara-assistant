/**
 * Finds the moments the notch's animation stops being smooth, for chasing
 * stutter. Turn it on by setting `localStorage["zara-frame-probe"]` to "1" in
 * the notch window's DevTools and reloading; every hitch is then added to the
 * diagnostics log (`%LOCALAPPDATA%\com.zara.app\diagnostics.log`) as:
 *
 *   frame_gap gap_ms=<n>        a frame arrived <n> ms after the previous one
 *   long_task duration_ms=<n>   the page's main thread was busy for <n> ms
 *
 * Read together with `ui_stall` lines from the backend (see stall_probe.rs):
 * a `long_task` with no `ui_stall` means the page itself was busy (rendering,
 * layout, scripts); a `ui_stall` at the same moment means the backend's UI
 * thread was too.
 */

/** Two frames at 60 Hz: a gap this long is a dropped frame the eye can catch. */
export const FRAME_GAP_THRESHOLD_MS = 34;

/**
 * Longer than this is the window having been hidden (the browser stops
 * animation frames then), not a hitch.
 */
const HIDDEN_WINDOW_GAP_MS = 1000;

export const FRAME_PROBE_STORAGE_KEY = "zara-frame-probe";

/**
 * Takes the timestamp of each animation frame in turn and returns how many
 * milliseconds late it was when that is a hitch, otherwise null.
 */
export function createFrameGapDetector(): (frameTimeMs: number) => number | null {
	let previousFrameTimeMs: number | null = null;
	return (frameTimeMs) => {
		const gap = previousFrameTimeMs === null ? null : frameTimeMs - previousFrameTimeMs;
		previousFrameTimeMs = frameTimeMs;
		if (gap === null || gap < FRAME_GAP_THRESHOLD_MS || gap > HIDDEN_WINDOW_GAP_MS) return null;
		return Math.round(gap);
	};
}

export type ProbeReport = (event: string, detail: string) => void;

/** Starts reporting hitches to `report`. Returns a function that stops it. */
export function startFramePacingProbe(report: ProbeReport): () => void {
	const detectGap = createFrameGapDetector();
	let frame = 0;
	const onFrame = (frameTimeMs: number) => {
		const gap = detectGap(frameTimeMs);
		if (gap !== null) report("frame_gap", `gap_ms=${gap}`);
		frame = requestAnimationFrame(onFrame);
	};
	frame = requestAnimationFrame(onFrame);

	let observer: PerformanceObserver | null = null;
	try {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				report("long_task", `duration_ms=${Math.round(entry.duration)}`);
			}
		});
		observer.observe({ entryTypes: ["longtask"] });
	} catch {
		// The long-task API is not offered here; frame gaps still tell most of the story.
		observer = null;
	}

	return () => {
		cancelAnimationFrame(frame);
		observer?.disconnect();
	};
}

/** True when the probe has been switched on for this window. */
export function frameProbeRequested(): boolean {
	return localStorage.getItem(FRAME_PROBE_STORAGE_KEY) === "1";
}
