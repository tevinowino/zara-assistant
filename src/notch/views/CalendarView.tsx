import { useEffect, useRef, type KeyboardEvent, type WheelEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "../../icons/glyphs";
import { isSameDay, weekdayInitials } from "../calendar/calendarMonth";
import { useMonthNavigation } from "../calendar/useMonthNavigation";

/** Moving a month by the scroll wheel waits this long between pages, in milliseconds. */
const WHEEL_PAGE_COOLDOWN_MS = 220;
const MONTH_SLIDE_PX = 22;

/**
 * A month calendar that moves between months (chevrons, the scroll wheel, PageUp and
 * PageDown) with a card describing the selected day: its weekday, week number, place in
 * the year and distance from today. Arrow keys move the selected day.
 */
export function CalendarView() {
	const navigation = useMonthNavigation();
	const { grid, weekStart, today, selectedDate, selectedDateDetails, lastDirection } = navigation;
	const gridRegionRef = useRef<HTMLDivElement>(null);
	const keyboardDrivenRef = useRef(false);
	const lastWheelPageAtRef = useRef(0);

	const monthName = new Intl.DateTimeFormat(undefined, { month: "long" }).format(
		new Date(grid.month.year, grid.month.month, 1)
	);
	const canReturnToToday = !navigation.isShowingToday || !isSameDay(selectedDate, today);

	// After a keyboard move, keep focus on the newly selected day.
	useEffect(() => {
		if (!keyboardDrivenRef.current) return;
		gridRegionRef.current?.querySelector<HTMLButtonElement>("[data-selected='true']")?.focus();
	}, [selectedDate]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const moves: Record<string, () => void> = {
			ArrowLeft: () => navigation.moveSelectionByDays(-1),
			ArrowRight: () => navigation.moveSelectionByDays(1),
			ArrowUp: () => navigation.moveSelectionByDays(-7),
			ArrowDown: () => navigation.moveSelectionByDays(7),
			PageUp: navigation.goToPreviousMonth,
			PageDown: navigation.goToNextMonth,
			Home: navigation.goToToday
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		keyboardDrivenRef.current = true;
		move();
	};

	const onWheel = (event: WheelEvent<HTMLDivElement>) => {
		const now = Date.now();
		if (now - lastWheelPageAtRef.current < WHEEL_PAGE_COOLDOWN_MS) return;
		if (Math.abs(event.deltaY) < 4) return;
		lastWheelPageAtRef.current = now;
		if (event.deltaY > 0) navigation.goToNextMonth();
		else navigation.goToPreviousMonth();
	};

	return (
		<div className="calendar-view">
			<section className="calendar-month-pane" aria-label="Calendar">
				<header className="calendar-month-header">
					<h2 className="calendar-month-title">
						{monthName} <span className="calendar-month-year">{grid.month.year}</span>
					</h2>
					<div className="calendar-month-nav">
						<button
							type="button"
							className="calendar-today-button"
							onClick={navigation.goToToday}
							disabled={!canReturnToToday}
						>
							Today
						</button>
						<button
							type="button"
							className="calendar-nav-button"
							aria-label="Previous month"
							onClick={navigation.goToPreviousMonth}
						>
							<ChevronLeft size={15} strokeWidth={2.2} />
						</button>
						<button
							type="button"
							className="calendar-nav-button"
							aria-label="Next month"
							onClick={navigation.goToNextMonth}
						>
							<ChevronRight size={15} strokeWidth={2.2} />
						</button>
					</div>
				</header>

				<div
					ref={gridRegionRef}
					className="calendar-grid-region"
					role="group"
					aria-label="Days of the month"
					onKeyDown={onKeyDown}
					onWheel={onWheel}
					onPointerDown={() => {
						keyboardDrivenRef.current = false;
					}}
				>
					<div className="calendar-weekdays" aria-hidden="true">
						<span className="calendar-week-number" />
						{weekdayInitials(weekStart).map((initial, column) => (
							<span key={column} className="day-name">
								{initial}
							</span>
						))}
					</div>

					<div className="calendar-weeks-frame">
						<AnimatePresence initial={false} mode="popLayout" custom={lastDirection}>
							<motion.div
								key={`${grid.month.year}-${grid.month.month}`}
								className="calendar-weeks"
								custom={lastDirection}
								variants={{
									enter: (direction: number) => ({ x: direction * MONTH_SLIDE_PX, opacity: 0 }),
									center: { x: 0, opacity: 1 },
									exit: (direction: number) => ({ x: -direction * MONTH_SLIDE_PX, opacity: 0 })
								}}
								initial="enter"
								animate="center"
								exit="exit"
								transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
							>
								{grid.weeks.map((week) => (
									<div key={week.days[0].date.getTime()} className="calendar-week">
										<span className="calendar-week-number" aria-hidden="true">
											{week.weekNumber}
										</span>
										{week.days.map((day) => {
											const isSelected = isSameDay(day.date, selectedDate);
											return (
												<button
													key={day.date.getTime()}
													type="button"
													className={[
														"calendar-day",
														day.inVisibleMonth ? "" : "outside-month",
														day.isToday ? "today" : "",
														isSelected ? "selected" : ""
													]
														.filter(Boolean)
														.join(" ")}
													data-selected={isSelected}
													tabIndex={isSelected ? 0 : -1}
													aria-pressed={isSelected}
													aria-current={day.isToday ? "date" : undefined}
													aria-label={new Intl.DateTimeFormat(undefined, {
														dateStyle: "full"
													}).format(day.date)}
													onClick={() => navigation.selectDate(day.date)}
												>
													{day.date.getDate()}
												</button>
											);
										})}
									</div>
								))}
							</motion.div>
						</AnimatePresence>
					</div>
				</div>
			</section>

			<aside className="calendar-day-card" aria-label="Selected day" aria-live="polite">
				<motion.div
					key={selectedDate.getTime()}
					className="calendar-day-card-body"
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.16, ease: "easeOut" }}
				>
					<span className="calendar-day-card-weekday">{selectedDateDetails.weekday}</span>
					<span className="calendar-day-card-number">{selectedDateDetails.dayOfMonth}</span>
					<span className="calendar-day-card-date">{selectedDateDetails.fullDate}</span>
					<dl className="calendar-day-card-facts">
						<div>
							<dt>Relative</dt>
							<dd>{selectedDateDetails.relativeToToday}</dd>
						</div>
						<div>
							<dt>Week</dt>
							<dd>{selectedDateDetails.isoWeekNumber}</dd>
						</div>
						<div>
							<dt>Day of year</dt>
							<dd>
								{selectedDateDetails.dayOfYear}
								<span className="calendar-day-card-of"> / {selectedDateDetails.daysInYear}</span>
							</dd>
						</div>
					</dl>
				</motion.div>
			</aside>
		</div>
	);
}
