import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { formatTimerTime } from "./timerFormat";
import { getTimerChimeCtx, playTimerChime } from "./timerChime";
import {
	initialTimerState,
	remainingFraction,
	remainingSeconds,
	transition,
	type TimerState
} from "./timerMachine";
import { parseRecentDurations, withRecentDuration } from "./timerPresets";

const LAST_DURATION_KEY = "zara-timer-last-duration";
const RECENT_DURATIONS_KEY = "zara-timer-recent-durations";
const DEFAULT_DURATION_SECONDS = 25 * 60;
/** How often a running timer checks the clock, in milliseconds. */
const CHECK_INTERVAL_MS = 250;

export interface UseTimerOptions {
	/** Whether the end-time hint is shown on a 24-hour clock. */
	timeFormat24h: boolean;
	/** Whether the completion chime plays. */
	soundEnabled: boolean;
	/** The notch's mode setting; "peek" reveals the notch when the timer ends. */
	notchMode: string;
	/** Reveals the notch for the given number of milliseconds. */
	triggerEventPeek: (duration?: number) => void;
}

function readLastDurationSeconds(): number {
	const stored = parseInt(localStorage.getItem(LAST_DURATION_KEY) || "", 10);
	return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DURATION_SECONDS;
}

/**
 * The notch's countdown timer: its state, and the controls that set, start, pause and
 * cancel it. Plays a chime when it ends and, in peek mode, reveals the notch. The last
 * duration and the last few custom ones are remembered across restarts.
 *
 * The timer counts down to a moment in time (see timerMachine.ts), checks the clock
 * four times a second, and re-renders once a second, when the displayed time changes.
 */
export function useTimer({
	timeFormat24h,
	soundEnabled,
	notchMode,
	triggerEventPeek
}: UseTimerOptions) {
	const [state, dispatch] = useReducer(transition, undefined, () =>
		initialTimerState(readLastDurationSeconds())
	);
	// The clock reading the display was last computed from. Moves on only when the
	// displayed second does, which is what keeps this hook cheap to render.
	const [displayNowMs, setDisplayNowMs] = useState(() => Date.now());
	const [recentDurations, setRecentDurations] = useState(() =>
		parseRecentDurations(localStorage.getItem(RECENT_DURATIONS_KEY))
	);
	const previousPhaseRef = useRef<TimerState["phase"]>(state.phase);

	useEffect(() => {
		if (state.phase !== "running") return;
		setDisplayNowMs(Date.now());
		const interval = setInterval(() => {
			const nowMs = Date.now();
			dispatch({ type: "tick", nowMs });
			setDisplayNowMs((shown) =>
				remainingSeconds(state, shown) === remainingSeconds(state, nowMs) ? shown : nowMs
			);
		}, CHECK_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [state]);

	useEffect(() => {
		if (state.durationSeconds > 0) {
			localStorage.setItem(LAST_DURATION_KEY, String(state.durationSeconds));
		}
	}, [state.durationSeconds]);

	// Completion moment: chime once and reveal the notch in peek mode.
	useEffect(() => {
		if (state.phase === "finished" && previousPhaseRef.current !== "finished") {
			if (soundEnabled) playTimerChime();
			if (notchMode === "peek") triggerEventPeek(6000);
		}
		previousPhaseRef.current = state.phase;
	}, [state.phase, soundEnabled, notchMode, triggerEventPeek]);

	const start = useCallback(
		(seconds?: number) => {
			// Unlock audio here (a user gesture) so the chime can play when the timer ends.
			getTimerChimeCtx();
			const startedSeconds = seconds ?? state.durationSeconds;
			dispatch({ type: "start", nowMs: Date.now(), seconds });
			setRecentDurations((recents) => {
				const next = withRecentDuration(recents, startedSeconds);
				localStorage.setItem(RECENT_DURATIONS_KEY, JSON.stringify(next));
				return next;
			});
		},
		[state.durationSeconds]
	);
	const pause = useCallback(() => dispatch({ type: "pause", nowMs: Date.now() }), []);
	const resume = useCallback(() => {
		getTimerChimeCtx();
		dispatch({ type: "resume", nowMs: Date.now() });
	}, []);
	const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
	const setDuration = useCallback(
		(seconds: number) => dispatch({ type: "set-duration", seconds }),
		[]
	);

	const secondsLeft = remainingSeconds(state, displayNowMs);
	const endsAtLabel =
		state.phase === "running"
			? new Date(state.endsAtMs).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					hour12: !timeFormat24h
				})
			: null;

	return {
		phase: state.phase,
		/** The length the wheels show and the timer last ran for, in seconds. */
		durationSeconds: state.durationSeconds,
		remainingSeconds: secondsLeft,
		/** How much is left, 1 down to 0, for the progress ring. */
		remainingFraction: remainingFraction(state, displayNowMs),
		/** When a running timer will end, as a clock time; null unless running. */
		endsAtLabel,
		recentDurations,
		/** Starts counting down `seconds`, or the length the wheels show. */
		start,
		pause,
		resume,
		cancel,
		/** Sets the length the wheels show. Ignored while a timer is running. */
		setDuration,

		// What the collapsed notch and the assistant's actions use.
		timerSeconds: secondsLeft,
		isTimerFinished: state.phase === "finished",
		formatTimerTime,
		resetTimer: cancel,
		startTimer: start
	};
}

export type TimerController = ReturnType<typeof useTimer>;
