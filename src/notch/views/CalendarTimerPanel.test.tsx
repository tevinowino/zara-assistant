import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarTimerPanel } from "./CalendarTimerPanel";
import { makeTimerController } from "../../test/timerController";

describe("CalendarTimerPanel", () => {
	it("shows nothing when the calendar panel is turned off in Settings", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled={false}
				isCalendarMode
			/>
		);

		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
	});

	it("shows nothing while the notch is on another panel", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled
				isCalendarMode={false}
			/>
		);

		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
	});

	it("opens on the calendar when no timer is counting", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);

		expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
	});

	it("switches to the timer and back", async () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: "Timer" }));
		expect(screen.getByRole("spinbutton", { name: "minutes" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Next month" })).not.toBeInTheDocument();

		await user.click(screen.getByRole("tab", { name: "Calendar" }));
		expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
	});

	it("opens on the timer when one is running, and shows the time left on its tab", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "running", remainingSeconds: 754 })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);

		expect(screen.getByRole("tab", { name: "Timer 12:34" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
	});

	it("opens on the timer when one is paused", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "paused", remainingSeconds: 300 })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);

		expect(screen.getByRole("tab", { name: "Timer 5:00" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
	});

	it("opens on the timer when one has finished, and says it ended", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "finished" })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);

		expect(screen.getByRole("tab", { name: "Timer Ended" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByRole("button", { name: "Repeat" })).toBeInTheDocument();
	});

	it("keeps showing the time left on the timer tab while the calendar is open", async () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "running", remainingSeconds: 754 })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: "Calendar" }));

		expect(screen.getByRole("tab", { name: "Timer 12:34" })).toHaveAttribute(
			"aria-selected",
			"false"
		);
		expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
	});

	it("shows the Ask Zara bar above the switcher when the assistant is on", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled
				isCalendarMode
				ask={{ busy: false, onSubmit: vi.fn(), onFocusChange: vi.fn() }}
			/>
		);

		expect(screen.getByRole("textbox")).toBeInTheDocument();
	});

	it("leaves the Ask Zara bar out when the assistant is off", () => {
		render(
			<CalendarTimerPanel
				timer={makeTimerController({ phase: "idle" })}
				settingsCalendarEnabled
				isCalendarMode
			/>
		);

		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("does not let clicks inside reach the notch, which would switch its mode", async () => {
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<CalendarTimerPanel
					timer={makeTimerController({ phase: "idle" })}
					settingsCalendarEnabled
					isCalendarMode
				/>
			</div>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: "Timer" }));

		expect(notchClick).not.toHaveBeenCalled();
	});
});
