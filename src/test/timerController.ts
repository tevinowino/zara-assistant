import { vi } from "vitest";
import type { TimerController } from "../notch/timer/useTimer";

/**
 * A timer controller whose actions are spies, for rendering timer views in a given state.
 * Technical boilerplate only: the state a test cares about is passed in by the test.
 */
export function makeTimerController(state: Partial<TimerController>): TimerController {
	return {
		phase: "idle",
		durationSeconds: 1500,
		remainingSeconds: 0,
		remainingFraction: 1,
		endsAtLabel: null,
		recentDurations: [],
		start: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		cancel: vi.fn(),
		setDuration: vi.fn(),
		timerSeconds: 0,
		isTimerFinished: false,
		formatTimerTime: () => "",
		resetTimer: vi.fn(),
		startTimer: vi.fn(),
		...state
	};
}
