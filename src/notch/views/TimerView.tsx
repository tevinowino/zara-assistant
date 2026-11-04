import { useRef, type KeyboardEvent } from "react";
import { DurationWheels } from "../components/DurationWheels";
import { TimerRing } from "../components/TimerRing";
import { formatClock, formatDurationLabel } from "../timer/timerFormat";
import { TIMER_PRESET_SECONDS } from "../timer/timerPresets";
import type { TimerController } from "../timer/useTimer";

export interface TimerViewProps {
	timer: TimerController;
}

/**
 * The timer, in two faces. Set up (idle): iOS-style wheels, a Start button, and one-tap
 * shortcuts for the common and the recent lengths. Counting (running, paused or
 * finished): a progress ring between a Cancel button and a Pause/Resume one.
 *
 * Keyboard, when the view has focus: Space or Enter starts, pauses and resumes; Enter
 * repeats a finished timer; Escape cancels a timer that has been started.
 */
export function TimerView({ timer }: TimerViewProps) {
	const viewRef = useRef<HTMLDivElement>(null);
	const { phase } = timer;

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// A focused wheel or button keeps its own keys; Space and Enter are only the
		// view's when focus is on the view itself.
		const isOnView = event.target === event.currentTarget;
		if (event.key === "Escape" && phase !== "idle") {
			event.preventDefault();
			event.stopPropagation();
			timer.cancel();
		} else if (isOnView && (event.key === " " || event.key === "Enter")) {
			event.preventDefault();
			if (phase === "running") timer.pause();
			else if (phase === "paused") timer.resume();
			else timer.start();
		}
	};

	return (
		<div
			ref={viewRef}
			className="timer-view"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) viewRef.current?.focus();
			}}
		>
			{phase === "idle" ? <TimerSetup timer={timer} /> : <TimerCounting timer={timer} />}
		</div>
	);
}

function TimerSetup({ timer }: TimerViewProps) {
	const { durationSeconds, recentDurations } = timer;
	const startLabel =
		durationSeconds > 0 ? `Start ${formatDurationLabel(durationSeconds)}` : "Start";

	return (
		<>
			<div className="timer-setup">
				<DurationWheels seconds={durationSeconds} onChange={timer.setDuration} />
				<button
					type="button"
					className="timer-button timer-button--start timer-start-bar"
					disabled={durationSeconds === 0}
					onClick={() => timer.start()}
				>
					{startLabel}
				</button>
			</div>

			<aside className="timer-shortcuts" aria-label="Quick start">
				<h3 className="timer-shortcuts-heading">Quick start</h3>
				<div className="timer-shortcut-grid">
					{TIMER_PRESET_SECONDS.map((seconds) => (
						<button
							key={seconds}
							type="button"
							className="timer-shortcut"
							onClick={() => timer.start(seconds)}
						>
							{formatDurationLabel(seconds)}
						</button>
					))}
				</div>
				{recentDurations.length > 0 && (
					<>
						<h3 className="timer-shortcuts-heading">Recent</h3>
						<div className="timer-shortcut-grid timer-shortcut-grid--list">
							{recentDurations.map((seconds) => (
								<button
									key={seconds}
									type="button"
									className="timer-shortcut"
									onClick={() => timer.start(seconds)}
								>
									{formatDurationLabel(seconds)}
								</button>
							))}
						</div>
					</>
				)}
			</aside>
		</>
	);
}

function TimerCounting({ timer }: TimerViewProps) {
	const { phase } = timer;
	const isFinished = phase === "finished";
	const ringPhase = phase === "idle" ? "running" : phase;
	const clockText = formatClock(timer.remainingSeconds);
	const caption = isFinished
		? "Time's up"
		: phase === "paused"
			? "Paused"
			: timer.endsAtLabel
				? `Ends ${timer.endsAtLabel}`
				: "";

	return (
		<div className="timer-counting">
			<button
				type="button"
				className="timer-button timer-button--cancel timer-round-button"
				onClick={timer.cancel}
			>
				{isFinished ? "Done" : "Cancel"}
			</button>

			<TimerRing remainingFraction={timer.remainingFraction} phase={ringPhase}>
				<span className="timer-ring-time" data-long={clockText.length > 5} aria-live="off">
					{clockText}
				</span>
				<span className="timer-ring-caption">{caption}</span>
			</TimerRing>

			{isFinished ? (
				<button
					type="button"
					className="timer-button timer-button--start timer-round-button"
					onClick={() => timer.start()}
				>
					Repeat
				</button>
			) : phase === "running" ? (
				<button
					type="button"
					className="timer-button timer-button--pause timer-round-button"
					onClick={timer.pause}
				>
					Pause
				</button>
			) : (
				<button
					type="button"
					className="timer-button timer-button--start timer-round-button"
					onClick={timer.resume}
				>
					Resume
				</button>
			)}
		</div>
	);
}
