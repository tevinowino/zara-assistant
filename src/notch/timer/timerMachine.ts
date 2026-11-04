import { clampTimerSeconds } from "./timerFormat";

/**
 * The countdown timer as a state machine. Pure: every transition is given the time it
 * happens at, so it never reads the clock itself.
 *
 *   idle ──start──▶ running ◀──resume── paused
 *     ▲               │  └────pause─────▲
 *     │               └─ the end time passes ─▶ finished
 *     └───────────────cancel (from any state)────┘
 *
 * A running timer remembers the moment it will end, not a count of seconds left, so a
 * throttled or suspended window cannot make it drift. `durationSeconds` is the length
 * the wheels show and the timer last ran for; it survives every state, so "Repeat"
 * and "Cancel" always know what to go back to.
 */
export type TimerState =
	| { phase: "idle"; durationSeconds: number }
	| { phase: "running"; durationSeconds: number; endsAtMs: number }
	| { phase: "paused"; durationSeconds: number; remainingMs: number }
	| { phase: "finished"; durationSeconds: number };

export type TimerEvent =
	/** Sets the length while no timer is running. */
	| { type: "set-duration"; seconds: number }
	/** Starts counting down `seconds` (the length the wheels show when omitted). */
	| { type: "start"; nowMs: number; seconds?: number }
	| { type: "pause"; nowMs: number }
	| { type: "resume"; nowMs: number }
	/** Stops the timer and returns to idle. */
	| { type: "cancel" }
	/** Reports that time has passed; finishes a running timer whose end has come. */
	| { type: "tick"; nowMs: number };

export function initialTimerState(durationSeconds: number): TimerState {
	return { phase: "idle", durationSeconds: clampTimerSeconds(durationSeconds) };
}

export function transition(state: TimerState, event: TimerEvent): TimerState {
	switch (event.type) {
		case "set-duration":
			return state.phase === "idle"
				? { phase: "idle", durationSeconds: clampTimerSeconds(event.seconds) }
				: state;
		case "start": {
			const durationSeconds = clampTimerSeconds(event.seconds ?? state.durationSeconds);
			if (durationSeconds === 0) return state;
			return {
				phase: "running",
				durationSeconds,
				endsAtMs: event.nowMs + durationSeconds * 1000
			};
		}
		case "pause":
			return state.phase === "running"
				? {
						phase: "paused",
						durationSeconds: state.durationSeconds,
						remainingMs: Math.max(0, state.endsAtMs - event.nowMs)
					}
				: state;
		case "resume":
			return state.phase === "paused"
				? {
						phase: "running",
						durationSeconds: state.durationSeconds,
						endsAtMs: event.nowMs + state.remainingMs
					}
				: state;
		case "cancel":
			return { phase: "idle", durationSeconds: state.durationSeconds };
		case "tick":
			return state.phase === "running" && event.nowMs >= state.endsAtMs
				? { phase: "finished", durationSeconds: state.durationSeconds }
				: state;
	}
}

/**
 * Whole seconds left, rounded up so the display reads 0:01 until the very end. Zero when
 * nothing is counting down.
 */
export function remainingSeconds(state: TimerState, nowMs: number): number {
	if (state.phase === "running") return Math.max(0, Math.ceil((state.endsAtMs - nowMs) / 1000));
	if (state.phase === "paused") return Math.ceil(state.remainingMs / 1000);
	return 0;
}

/** How much of the timer is left, from 1 (just started) to 0, for the progress ring. */
export function remainingFraction(state: TimerState, nowMs: number): number {
	if (state.phase === "finished") return 0;
	if (state.phase === "idle" || state.durationSeconds === 0) return 1;
	const leftMs =
		state.phase === "running" ? Math.max(0, state.endsAtMs - nowMs) : state.remainingMs;
	return Math.min(1, leftMs / (state.durationSeconds * 1000));
}
