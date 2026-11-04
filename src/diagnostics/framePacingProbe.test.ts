import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createFrameGapDetector,
	frameProbeRequested,
	startFramePacingProbe
} from "./framePacingProbe";

describe("the frame gap detector", () => {
	it("ignores the first frame, which has nothing to be compared with", () => {
		const detect = createFrameGapDetector();

		expect(detect(1000)).toBeNull();
	});

	it("ignores frames that arrive on time", () => {
		const detect = createFrameGapDetector();
		detect(1000);

		expect(detect(1016.7)).toBeNull();
		expect(detect(1033.4)).toBeNull();
	});

	it("reports a frame that arrived two frames late", () => {
		const detect = createFrameGapDetector();
		detect(1000);

		expect(detect(1050)).toBe(50);
	});

	it("measures each frame against the one before it, not the first", () => {
		const detect = createFrameGapDetector();
		detect(1000);
		detect(1016);

		expect(detect(1100)).toBe(84);
		expect(detect(1116)).toBeNull();
	});

	it("does not call the time a hidden window was paused a hitch", () => {
		const detect = createFrameGapDetector();
		detect(1000);

		expect(detect(60000)).toBeNull();
	});
});

describe("starting the frame pacing probe", () => {
	let frameCallback: ((frameTimeMs: number) => void) | null;

	beforeEach(() => {
		frameCallback = null;
		vi.stubGlobal("requestAnimationFrame", (callback: (frameTimeMs: number) => void) => {
			frameCallback = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {
			frameCallback = null;
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it("reports a late frame to the log with how late it was", () => {
		const report = vi.fn();
		startFramePacingProbe(report);

		frameCallback?.(2000);
		frameCallback?.(2016);
		frameCallback?.(2120);

		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith("frame_gap", "gap_ms=104");
	});

	it("stops watching frames once stopped", () => {
		const stop = startFramePacingProbe(vi.fn());

		stop();

		expect(frameCallback).toBeNull();
	});

	it("is only requested when the window's flag is set", () => {
		expect(frameProbeRequested()).toBe(false);

		localStorage.setItem("zara-frame-probe", "1");

		expect(frameProbeRequested()).toBe(true);
	});
});
