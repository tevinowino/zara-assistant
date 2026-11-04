import type { ReactNode } from "react";

const RING_SIZE_PX = 148;
const RING_STROKE_PX = 7;
const RING_RADIUS = (RING_SIZE_PX - RING_STROKE_PX) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface TimerRingProps {
	/** How much of the timer is left, 1 (all of it) down to 0. */
	remainingFraction: number;
	phase: "running" | "paused" | "finished";
	/** Drawn in the middle: the time left and what it means. */
	children: ReactNode;
}

/**
 * The timer's progress ring: an arc that shrinks as time runs out, with the time in the
 * middle. The arc eases between whole seconds so it moves continuously rather than ticking.
 */
export function TimerRing({ remainingFraction, phase, children }: TimerRingProps) {
	// A finished timer shows a whole ring, pulsing, rather than an empty one.
	const clamped = phase === "finished" ? 1 : Math.min(1, Math.max(0, remainingFraction));

	return (
		<div
			className={`timer-ring timer-ring--${phase}`}
			style={{ width: RING_SIZE_PX, height: RING_SIZE_PX }}
		>
			<svg width={RING_SIZE_PX} height={RING_SIZE_PX} aria-hidden="true">
				<circle
					className="timer-ring-track"
					cx={RING_SIZE_PX / 2}
					cy={RING_SIZE_PX / 2}
					r={RING_RADIUS}
					strokeWidth={RING_STROKE_PX}
					fill="none"
				/>
				<circle
					className="timer-ring-arc"
					cx={RING_SIZE_PX / 2}
					cy={RING_SIZE_PX / 2}
					r={RING_RADIUS}
					strokeWidth={RING_STROKE_PX}
					fill="none"
					strokeLinecap="round"
					strokeDasharray={RING_CIRCUMFERENCE}
					strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
					transform={`rotate(-90 ${RING_SIZE_PX / 2} ${RING_SIZE_PX / 2})`}
				/>
			</svg>
			<div className="timer-ring-content">{children}</div>
		</div>
	);
}
