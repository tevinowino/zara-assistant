import { useCallback, useEffect, useMemo, useRef } from "react";

export interface DelayedAction {
	/** Runs `action` after the delay. Ignored while an earlier one is still waiting. */
	schedule: (action: () => void) => void;
	/** Drops the waiting action, if any. */
	cancel: () => void;
}

/**
 * One action that runs after a delay unless it is cancelled first, such as
 * closing the notch a moment after the pointer leaves it. A second `schedule`
 * while one is waiting does not push the deadline back, so a pointer that
 * keeps twitching outside cannot hold the notch open. Anything still waiting
 * when the component goes away is dropped.
 */
export function useDelayedAction(delayInMilliseconds: number): DelayedAction {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const cancel = useCallback(() => {
		if (timer.current === null) return;
		clearTimeout(timer.current);
		timer.current = null;
	}, []);

	const schedule = useCallback(
		(action: () => void) => {
			if (timer.current !== null) return;
			timer.current = setTimeout(() => {
				timer.current = null;
				action();
			}, delayInMilliseconds);
		},
		[delayInMilliseconds]
	);

	useEffect(() => cancel, [cancel]);

	return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
