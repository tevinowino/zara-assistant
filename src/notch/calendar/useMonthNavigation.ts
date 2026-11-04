import { useCallback, useMemo, useState } from "react";
import {
	addDays,
	addMonths,
	buildMonthGrid,
	describeDate,
	isSameMonth,
	localeWeekStart,
	monthDirection,
	monthOf,
	type CalendarMonth,
	type DateDetails,
	type MonthGrid
} from "./calendarMonth";

export interface MonthNavigation {
	grid: MonthGrid;
	/** 0 for Sunday through 6 for Saturday: the first column of the grid. */
	weekStart: number;
	/** The current date, as of when the calendar opened or last went to today. */
	today: Date;
	selectedDate: Date;
	selectedDateDetails: DateDetails;
	/** Whether the grid shows today's month, so a "Today" button has nothing to do. */
	isShowingToday: boolean;
	/** Which way the last month change went, for the slide animation: -1, 0 or 1. */
	lastDirection: -1 | 0 | 1;
	goToPreviousMonth: () => void;
	goToNextMonth: () => void;
	goToToday: () => void;
	/** Selects a date, showing its month if it is not on the grid. */
	selectDate: (date: Date) => void;
	/** Moves the selection by whole days (the arrow keys), turning the page when it leaves the month. */
	moveSelectionByDays: (days: number) => void;
}

/** Keeps `day` of the month if it exists there, otherwise the month's last day. */
function sameDayInMonth(day: number, month: CalendarMonth): Date {
	const lastDay = new Date(month.year, month.month + 1, 0).getDate();
	return new Date(month.year, month.month, Math.min(day, lastDay));
}

/**
 * Which month the calendar shows and which date is selected. Changing month moves the
 * selection with it (to today when landing on today's month, otherwise to the same day
 * of the month), so the details card always describes a day the user can see.
 */
export function useMonthNavigation(now: () => Date = () => new Date()): MonthNavigation {
	const [today, setToday] = useState(now);
	const [visibleMonth, setVisibleMonth] = useState(() => monthOf(today));
	const [selectedDate, setSelectedDate] = useState(today);
	const [lastDirection, setLastDirection] = useState<-1 | 0 | 1>(0);
	const weekStart = useMemo(() => localeWeekStart(), []);

	const showMonth = useCallback(
		(month: CalendarMonth, direction: -1 | 0 | 1, currentToday: Date) => {
			setLastDirection(direction);
			setVisibleMonth(month);
			setSelectedDate(
				isSameMonth(month, monthOf(currentToday))
					? currentToday
					: sameDayInMonth(selectedDate.getDate(), month)
			);
		},
		[selectedDate]
	);

	const goToPreviousMonth = useCallback(
		() => showMonth(addMonths(visibleMonth, -1), -1, today),
		[showMonth, visibleMonth, today]
	);
	const goToNextMonth = useCallback(
		() => showMonth(addMonths(visibleMonth, 1), 1, today),
		[showMonth, visibleMonth, today]
	);

	const goToToday = useCallback(() => {
		const current = now();
		setToday(current);
		setLastDirection(monthDirection(visibleMonth, monthOf(current)));
		setVisibleMonth(monthOf(current));
		setSelectedDate(current);
	}, [now, visibleMonth]);

	const selectDate = useCallback(
		(date: Date) => {
			const month = monthOf(date);
			if (isSameMonth(month, visibleMonth)) {
				setSelectedDate(date);
				return;
			}
			setLastDirection(monthDirection(visibleMonth, month));
			setVisibleMonth(month);
			setSelectedDate(date);
		},
		[visibleMonth]
	);

	const moveSelectionByDays = useCallback(
		(days: number) => selectDate(addDays(selectedDate, days)),
		[selectDate, selectedDate]
	);

	const grid = useMemo(
		() => buildMonthGrid(visibleMonth, today, weekStart),
		[visibleMonth, today, weekStart]
	);
	const selectedDateDetails = useMemo(
		() => describeDate(selectedDate, today),
		[selectedDate, today]
	);

	return {
		grid,
		weekStart,
		today,
		selectedDate,
		selectedDateDetails,
		isShowingToday: isSameMonth(visibleMonth, monthOf(today)),
		lastDirection,
		goToPreviousMonth,
		goToNextMonth,
		goToToday,
		selectDate,
		moveSelectionByDays
	};
}
