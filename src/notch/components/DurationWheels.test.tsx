import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DurationWheels } from "./DurationWheels";

describe("DurationWheels", () => {
	it("shows 25 minutes as 0 hours, 25 minutes and 0 seconds", () => {
		render(<DurationWheels seconds={1500} onChange={() => {}} />);

		expect(screen.getByRole("spinbutton", { name: "hours" })).toHaveAttribute("aria-valuenow", "0");
		expect(screen.getByRole("spinbutton", { name: "minutes" })).toHaveAttribute(
			"aria-valuenow",
			"25"
		);
		expect(screen.getByRole("spinbutton", { name: "seconds" })).toHaveAttribute(
			"aria-valuenow",
			"0"
		);
	});

	it("shows 1 hour 5 minutes 9 seconds", () => {
		render(<DurationWheels seconds={3909} onChange={() => {}} />);

		expect(screen.getByRole("spinbutton", { name: "hours" })).toHaveAttribute("aria-valuenow", "1");
		expect(screen.getByRole("spinbutton", { name: "minutes" })).toHaveAttribute(
			"aria-valuenow",
			"5"
		);
		expect(screen.getByRole("spinbutton", { name: "seconds" })).toHaveAttribute(
			"aria-valuenow",
			"9"
		);
	});

	it("is a group named for the timer duration", () => {
		render(<DurationWheels seconds={1500} onChange={() => {}} />);

		expect(screen.getByRole("group", { name: "Timer duration" })).toBeInTheDocument();
	});

	it("adds a minute to the whole duration when the minutes wheel goes up", async () => {
		const onChange = vi.fn();
		render(<DurationWheels seconds={1500} onChange={onChange} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(26 * 60);
	});

	it("adds an hour to the whole duration when the hours wheel goes up", async () => {
		const onChange = vi.fn();
		render(<DurationWheels seconds={1500} onChange={onChange} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "hours" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(3600 + 1500);
	});

	it("changes only the seconds when the seconds wheel goes up", async () => {
		const onChange = vi.fn();
		render(<DurationWheels seconds={1500} onChange={onChange} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "seconds" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(1501);
	});

	it("holds the duration to three hours when the minutes go up at three hours", async () => {
		const onChange = vi.fn();
		render(<DurationWheels seconds={10800} onChange={onChange} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(10800);
	});

	it("holds the duration to three hours when 3 is typed on the hours wheel with minutes set", async () => {
		const onChange = vi.fn();
		render(<DurationWheels seconds={1500} onChange={onChange} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "hours" }).focus();
		await user.keyboard("3");

		// 3 hours and 25 minutes is past the limit, so it comes back to exactly 3 hours.
		expect(onChange).toHaveBeenCalledWith(10800);
	});
});
