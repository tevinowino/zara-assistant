import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimerView } from "./TimerView";
import { makeTimerController as makeTimer } from "../../test/timerController";

describe("TimerView setting up", () => {
	it("shows the wheels at the chosen length", () => {
		render(<TimerView timer={makeTimer({ phase: "idle", durationSeconds: 1500 })} />);

		expect(screen.getByRole("spinbutton", { name: "minutes" })).toHaveAttribute(
			"aria-valuenow",
			"25"
		);
	});

	it("names the length on the Start button", () => {
		render(<TimerView timer={makeTimer({ phase: "idle", durationSeconds: 5400 })} />);

		expect(screen.getByRole("button", { name: "Start 1 h 30 min" })).toBeInTheDocument();
	});

	it("starts the timer when Start is clicked", async () => {
		const timer = makeTimer({ phase: "idle", durationSeconds: 1500 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Start 25 min" }));

		expect(timer.start).toHaveBeenCalledWith();
	});

	it("cannot start a zero-length timer", () => {
		render(<TimerView timer={makeTimer({ phase: "idle", durationSeconds: 0 })} />);

		expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
	});

	it("changes the length when a wheel moves", async () => {
		const timer = makeTimer({ phase: "idle", durationSeconds: 1500 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(timer.setDuration).toHaveBeenCalledWith(26 * 60);
	});

	it.each([
		["5 min", 300],
		["10 min", 600],
		["15 min", 900],
		["25 min", 1500]
	])("starts a %s timer from its quick start button", async (label, seconds) => {
		const timer = makeTimer({ phase: "idle", durationSeconds: 3000 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: label }));

		expect(timer.start).toHaveBeenCalledWith(seconds);
	});

	it("lists no recent lengths when there are none", () => {
		render(<TimerView timer={makeTimer({ phase: "idle", recentDurations: [] })} />);

		expect(screen.queryByText("Recent")).not.toBeInTheDocument();
	});

	it("lists recent lengths and starts one when it is clicked", async () => {
		const timer = makeTimer({ phase: "idle", recentDurations: [420, 90] });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		expect(screen.getByText("Recent")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "7 min" }));

		expect(timer.start).toHaveBeenCalledWith(420);
		expect(screen.getByRole("button", { name: "1 min 30 sec" })).toBeInTheDocument();
	});

	it("starts on Space when the view itself has focus", async () => {
		const timer = makeTimer({ phase: "idle" });
		const { container } = render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		container.querySelector<HTMLElement>(".timer-view")?.focus();
		await user.keyboard(" ");

		expect(timer.start).toHaveBeenCalledWith();
	});

	it("does not start on Space while a wheel has focus", async () => {
		const timer = makeTimer({ phase: "idle" });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard(" ");

		expect(timer.start).not.toHaveBeenCalled();
	});

	it("does nothing on Escape while setting up", async () => {
		const timer = makeTimer({ phase: "idle" });
		const { container } = render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		container.querySelector<HTMLElement>(".timer-view")?.focus();
		await user.keyboard("{Escape}");

		expect(timer.cancel).not.toHaveBeenCalled();
	});
});

describe("TimerView running", () => {
	it("shows the time left and when it ends", () => {
		render(
			<TimerView
				timer={makeTimer({
					phase: "running",
					remainingSeconds: 1499,
					endsAtLabel: "6:25 PM"
				})}
			/>
		);

		expect(screen.getByText("24:59")).toBeInTheDocument();
		expect(screen.getByText("Ends 6:25 PM")).toBeInTheDocument();
	});

	it("shows hours once there are hours left", () => {
		render(<TimerView timer={makeTimer({ phase: "running", remainingSeconds: 3900 })} />);

		expect(screen.getByText("1:05:00")).toBeInTheDocument();
	});

	it("pauses from the Pause button", async () => {
		const timer = makeTimer({ phase: "running", remainingSeconds: 100 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Pause" }));

		expect(timer.pause).toHaveBeenCalledTimes(1);
	});

	it("cancels from the Cancel button", async () => {
		const timer = makeTimer({ phase: "running", remainingSeconds: 100 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(timer.cancel).toHaveBeenCalledTimes(1);
	});

	it("pauses on Space when the view has focus", async () => {
		const timer = makeTimer({ phase: "running", remainingSeconds: 100 });
		const { container } = render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		container.querySelector<HTMLElement>(".timer-view")?.focus();
		await user.keyboard(" ");

		expect(timer.pause).toHaveBeenCalledTimes(1);
	});

	it("cancels on Escape", async () => {
		const timer = makeTimer({ phase: "running", remainingSeconds: 100 });
		const { container } = render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		container.querySelector<HTMLElement>(".timer-view")?.focus();
		await user.keyboard("{Escape}");

		expect(timer.cancel).toHaveBeenCalledTimes(1);
	});

	it("has no setup controls while counting", () => {
		render(<TimerView timer={makeTimer({ phase: "running", remainingSeconds: 100 })} />);

		expect(screen.queryByRole("spinbutton", { name: "minutes" })).not.toBeInTheDocument();
		expect(screen.queryByText("Quick start")).not.toBeInTheDocument();
	});
});

describe("TimerView paused", () => {
	it("says it is paused and offers Resume", () => {
		render(<TimerView timer={makeTimer({ phase: "paused", remainingSeconds: 540 })} />);

		expect(screen.getByText("9:00")).toBeInTheDocument();
		expect(screen.getByText("Paused")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
	});

	it("resumes from the Resume button", async () => {
		const timer = makeTimer({ phase: "paused", remainingSeconds: 540 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Resume" }));

		expect(timer.resume).toHaveBeenCalledTimes(1);
	});

	it("resumes on Space when the view has focus", async () => {
		const timer = makeTimer({ phase: "paused", remainingSeconds: 540 });
		const { container } = render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		container.querySelector<HTMLElement>(".timer-view")?.focus();
		await user.keyboard(" ");

		expect(timer.resume).toHaveBeenCalledTimes(1);
	});
});

describe("TimerView finished", () => {
	it("says time is up and offers Done and Repeat", () => {
		render(<TimerView timer={makeTimer({ phase: "finished", remainingSeconds: 0 })} />);

		expect(screen.getByText("0:00")).toBeInTheDocument();
		expect(screen.getByText("Time's up")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Repeat" })).toBeInTheDocument();
	});

	it("dismisses from Done", async () => {
		const timer = makeTimer({ phase: "finished" });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Done" }));

		expect(timer.cancel).toHaveBeenCalledTimes(1);
	});

	it("starts the same length again from Repeat", async () => {
		const timer = makeTimer({ phase: "finished", durationSeconds: 600 });
		render(<TimerView timer={timer} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Repeat" }));

		expect(timer.start).toHaveBeenCalledWith();
	});
});
