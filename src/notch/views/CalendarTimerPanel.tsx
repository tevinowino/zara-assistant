import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AskBar } from "../../ai/AskBar";
import { PanelSwitcher } from "../components/PanelSwitcher";
import { formatTimerTime } from "../timer/timerFormat";
import type { TimerController } from "../timer/useTimer";
import { CalendarView } from "./CalendarView";
import { TimerView } from "./TimerView";

/** Height of the notch while it shows the calendar or timer, without the Ask Zara bar. */
export const CALENDAR_TIMER_PANEL_HEIGHT_PX = 330;
/** Width of the notch while it shows the calendar or timer. */
export const CALENDAR_TIMER_PANEL_WIDTH_PX = 480;

type PanelView = "calendar" | "timer";

export interface CalendarTimerPanelProps {
	/** Everything the timer hook exposes: its state and controls. */
	timer: TimerController;
	/** Whether the calendar panel is turned on in Settings. */
	settingsCalendarEnabled: boolean;
	/** Whether the notch is showing the calendar view. */
	isCalendarMode: boolean;
	/** The Ask Zara bar above the calendar; omitted when the assistant is turned off. */
	ask?: {
		busy: boolean;
		onSubmit: (question: string) => void;
		onFocusChange: (focused: boolean) => void;
	};
}

/**
 * The notch's calendar and timer, one at a time: a switcher on top and the chosen view
 * below it, both the same size so the notch does not change height as the user switches
 * or browses months.
 */
export function CalendarTimerPanel({
	timer,
	settingsCalendarEnabled,
	isCalendarMode,
	ask
}: CalendarTimerPanelProps) {
	return (
		<AnimatePresence>
			{settingsCalendarEnabled && isCalendarMode && (
				<motion.div
					className="calendar-timer-content"
					onClick={(e) => e.stopPropagation()} /* Block mode switches when clicking inside */
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
				>
					{ask && (
						<AskBar busy={ask.busy} onSubmit={ask.onSubmit} onFocusChange={ask.onFocusChange} />
					)}
					<SwitchableViews timer={timer} />
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/**
 * The switcher and its views. Mounted each time the panel opens, so it opens on the timer
 * when one is counting down or has just finished, and on the calendar (at today's month)
 * otherwise.
 */
function SwitchableViews({ timer }: { timer: TimerController }) {
	const [view, setView] = useState<PanelView>(timer.phase === "idle" ? "calendar" : "timer");
	const isFinished = timer.phase === "finished";
	const timerBadge =
		timer.phase === "running" || timer.phase === "paused"
			? formatTimerTime(timer.remainingSeconds)
			: isFinished
				? "Ended"
				: undefined;

	return (
		<>
			<PanelSwitcher
				aria-label="Calendar or timer"
				value={view}
				onValueChange={setView}
				items={[
					{ value: "calendar", label: "Calendar" },
					{ value: "timer", label: "Timer", badge: timerBadge, alert: isFinished }
				]}
			/>
			<div className="calendar-timer-body">
				{view === "calendar" ? <CalendarView /> : <TimerView timer={timer} />}
			</div>
		</>
	);
}
