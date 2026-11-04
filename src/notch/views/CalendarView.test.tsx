import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarView } from "./CalendarView";

describe("CalendarView", () => {
	beforeEach(() => {
		// Only the clock is faked, so animations and user-event keep their real timers.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0)); // Saturday 14 November 2026
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens on today's month", () => {
		render(<CalendarView />);

		expect(screen.getByRole("heading", { name: /November\s+2026/ })).toBeInTheDocument();
	});

	it("shows six weeks of seven days", () => {
		render(<CalendarView />);

		expect(screen.getAllByRole("button", { name: /20\d\d$/ })).toHaveLength(42);
	});

	it("marks today", () => {
		render(<CalendarView />);

		expect(screen.getByRole("button", { name: "Saturday, November 14, 2026" })).toHaveAttribute(
			"aria-current",
			"date"
		);
	});

	it("starts with today selected and described in the day card", () => {
		render(<CalendarView />);
		const card = screen.getByRole("complementary", { name: "Selected day" });

		expect(card).toHaveTextContent("Saturday");
		expect(card).toHaveTextContent("November 14, 2026");
		expect(card).toHaveTextContent("Today");
		expect(card).toHaveTextContent("Week46");
		expect(card).toHaveTextContent("Day of year318 / 365");
	});

	it("lists the weekdays starting on Sunday", () => {
		const { container } = render(<CalendarView />);

		const initials = Array.from(container.querySelectorAll(".day-name")).map((n) => n.textContent);

		expect(initials).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
	});

	it("shows the week number of each row", () => {
		const { container } = render(<CalendarView />);

		const weekNumbers = Array.from(
			container.querySelectorAll(".calendar-weeks .calendar-week-number")
		).map((n) => n.textContent);

		expect(weekNumbers).toEqual(["45", "46", "47", "48", "49", "50"]);
	});

	it("goes to the next month with the next button", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Next month" }));

		expect(screen.getByRole("heading", { name: /December\s+2026/ })).toBeInTheDocument();
	});

	it("goes to the previous month with the previous button", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Previous month" }));

		expect(screen.getByRole("heading", { name: /October\s+2026/ })).toBeInTheDocument();
	});

	it("carries on into the next year", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Next month" }));
		await user.click(screen.getByRole("button", { name: "Next month" }));

		expect(screen.getByRole("heading", { name: /January\s+2027/ })).toBeInTheDocument();
	});

	it("describes the same day of the month when the month changes", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Next month" }));
		const card = screen.getByRole("complementary", { name: "Selected day" });

		expect(card).toHaveTextContent("Monday");
		expect(card).toHaveTextContent("December 14, 2026");
		expect(card).toHaveTextContent("In 4 weeks");
	});

	it("has the Today button off while today is shown and selected", () => {
		render(<CalendarView />);

		expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
	});

	it("returns to today from another month with the Today button", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Next month" }));
		await user.click(screen.getByRole("button", { name: "Next month" }));

		await user.click(screen.getByRole("button", { name: "Today" }));

		expect(screen.getByRole("heading", { name: /November\s+2026/ })).toBeInTheDocument();
		expect(screen.getByRole("complementary", { name: "Selected day" })).toHaveTextContent("Today");
	});

	it("turns the Today button on after another day is selected", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Monday, November 23, 2026" }));

		expect(screen.getByRole("button", { name: "Today" })).toBeEnabled();
	});

	it("selects a day when it is clicked, and describes it", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Monday, November 23, 2026" }));

		expect(screen.getByRole("button", { name: "Monday, November 23, 2026" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Saturday, November 14, 2026" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		const card = screen.getByRole("complementary", { name: "Selected day" });
		expect(card).toHaveTextContent("Monday");
		expect(card).toHaveTextContent("In 9 days");
		expect(card).toHaveTextContent("Week48");
	});

	it("shows the next month when a day from it, at the end of the grid, is clicked", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Wednesday, December 2, 2026" }));

		expect(screen.getByRole("heading", { name: /December\s+2026/ })).toBeInTheDocument();
		// The old month is still sliding out, and also shows that day, until it finishes.
		await waitFor(() =>
			expect(screen.getAllByRole("button", { name: "Wednesday, December 2, 2026" })).toHaveLength(1)
		);
		expect(screen.getByRole("button", { name: "Wednesday, December 2, 2026" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("moves the selected day with the arrow keys", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		screen.getByRole("button", { name: "Saturday, November 14, 2026" }).focus();
		await user.keyboard("{ArrowRight}");
		expect(screen.getByRole("button", { name: "Sunday, November 15, 2026" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);

		await user.keyboard("{ArrowDown}");
		expect(screen.getByRole("button", { name: "Sunday, November 22, 2026" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);

		await user.keyboard("{ArrowLeft}");
		await user.keyboard("{ArrowUp}");
		expect(screen.getByRole("button", { name: "Saturday, November 14, 2026" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("keeps focus on the selected day after a keyboard move", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		screen.getByRole("button", { name: "Saturday, November 14, 2026" }).focus();
		await user.keyboard("{ArrowRight}");

		expect(screen.getByRole("button", { name: "Sunday, November 15, 2026" })).toHaveFocus();
	});

	it("turns the page with Page Down and Page Up", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();

		screen.getByRole("button", { name: "Saturday, November 14, 2026" }).focus();
		await user.keyboard("{PageDown}");
		expect(screen.getByRole("heading", { name: /December\s+2026/ })).toBeInTheDocument();

		await user.keyboard("{PageUp}");
		await user.keyboard("{PageUp}");
		expect(screen.getByRole("heading", { name: /October\s+2026/ })).toBeInTheDocument();
	});

	it("goes back to today with Home", async () => {
		render(<CalendarView />);
		const user = userEvent.setup();
		screen.getByRole("button", { name: "Saturday, November 14, 2026" }).focus();
		await user.keyboard("{PageDown}");
		await user.keyboard("{PageDown}");

		await user.keyboard("{Home}");

		expect(screen.getByRole("heading", { name: /November\s+2026/ })).toBeInTheDocument();
	});

	it("turns to the next month when the mouse wheel scrolls down over the days", () => {
		render(<CalendarView />);

		fireEvent.wheel(screen.getByRole("group", { name: "Days of the month" }), { deltaY: 100 });

		expect(screen.getByRole("heading", { name: /December\s+2026/ })).toBeInTheDocument();
	});

	it("turns to the previous month when the mouse wheel scrolls up over the days", () => {
		render(<CalendarView />);

		fireEvent.wheel(screen.getByRole("group", { name: "Days of the month" }), { deltaY: -100 });

		expect(screen.getByRole("heading", { name: /October\s+2026/ })).toBeInTheDocument();
	});

	it("turns only one page for a burst of wheel events", () => {
		render(<CalendarView />);
		const days = screen.getByRole("group", { name: "Days of the month" });

		fireEvent.wheel(days, { deltaY: 100 });
		fireEvent.wheel(days, { deltaY: 100 });
		fireEvent.wheel(days, { deltaY: 100 });

		expect(screen.getByRole("heading", { name: /December\s+2026/ })).toBeInTheDocument();
	});
});
