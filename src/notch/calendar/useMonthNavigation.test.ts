import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMonthNavigation } from "./useMonthNavigation";
import { isSameDay } from "./calendarMonth";

describe("useMonthNavigation", () => {
	it("starts on today's month with today selected", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		expect(result.current.grid.month).toEqual({ year: 2026, month: 10 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 10, 14))).toBe(true);
		expect(result.current.isShowingToday).toBe(true);
		expect(result.current.lastDirection).toBe(0);
	});

	it("goes to the next month and keeps the same day of the month selected", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		act(() => result.current.goToNextMonth());

		expect(result.current.grid.month).toEqual({ year: 2026, month: 11 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 11, 14))).toBe(true);
		expect(result.current.isShowingToday).toBe(false);
		expect(result.current.lastDirection).toBe(1);
	});

	it("goes to the previous month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		act(() => result.current.goToPreviousMonth());

		expect(result.current.grid.month).toEqual({ year: 2026, month: 9 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 9, 14))).toBe(true);
		expect(result.current.lastDirection).toBe(-1);
	});

	it("crosses a year boundary going forward and back", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 11, 20)));

		act(() => result.current.goToNextMonth());
		expect(result.current.grid.month).toEqual({ year: 2027, month: 0 });

		act(() => result.current.goToPreviousMonth());
		expect(result.current.grid.month).toEqual({ year: 2026, month: 11 });
	});

	it("clamps the selected day to the last day of a shorter month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 0, 31)));

		act(() => result.current.goToNextMonth());

		expect(isSameDay(result.current.selectedDate, new Date(2026, 1, 28))).toBe(true);
	});

	it("selects today again when browsing back to today's month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));
		act(() => result.current.goToNextMonth());
		act(() => result.current.selectDate(new Date(2026, 11, 25)));

		act(() => result.current.goToPreviousMonth());

		expect(isSameDay(result.current.selectedDate, new Date(2026, 10, 14))).toBe(true);
	});

	it("jumps back to today from a far-off month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));
		act(() => result.current.goToNextMonth());
		act(() => result.current.goToNextMonth());
		act(() => result.current.goToNextMonth());

		act(() => result.current.goToToday());

		expect(result.current.grid.month).toEqual({ year: 2026, month: 10 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 10, 14))).toBe(true);
		expect(result.current.isShowingToday).toBe(true);
		expect(result.current.lastDirection).toBe(-1);
	});

	it("selects a date in the shown month without changing the month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		act(() => result.current.selectDate(new Date(2026, 10, 3)));

		expect(result.current.grid.month).toEqual({ year: 2026, month: 10 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 10, 3))).toBe(true);
		expect(result.current.lastDirection).toBe(0);
	});

	it("shows the next month when a date from it is selected", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		act(() => result.current.selectDate(new Date(2026, 11, 2)));

		expect(result.current.grid.month).toEqual({ year: 2026, month: 11 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 11, 2))).toBe(true);
		expect(result.current.lastDirection).toBe(1);
	});

	it("moves the selection a week down and turns the page when it leaves the month", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 28)));

		act(() => result.current.moveSelectionByDays(7));

		expect(result.current.grid.month).toEqual({ year: 2026, month: 11 });
		expect(isSameDay(result.current.selectedDate, new Date(2026, 11, 5))).toBe(true);
	});

	it("describes the selected date relative to today", () => {
		const { result } = renderHook(() => useMonthNavigation(() => new Date(2026, 10, 14)));

		act(() => result.current.selectDate(new Date(2026, 10, 15)));

		expect(result.current.selectedDateDetails.dayOfMonth).toBe(15);
		expect(result.current.selectedDateDetails.relativeToToday).toBe("Tomorrow");
	});
});
