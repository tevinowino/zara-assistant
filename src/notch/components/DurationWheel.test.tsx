import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DurationWheel } from "./DurationWheel";

describe("DurationWheel", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is a spin button named for what it counts, showing its value and range", () => {
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={() => {}}
			/>
		);

		const wheel = screen.getByRole("spinbutton", { name: "minutes" });
		expect(wheel).toHaveAttribute("aria-valuenow", "25");
		expect(wheel).toHaveAttribute("aria-valuemin", "0");
		expect(wheel).toHaveAttribute("aria-valuemax", "59");
	});

	it("shows the value between its neighbours, two digits each", () => {
		const { container } = render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={() => {}}
			/>
		);

		const rows = Array.from(container.querySelectorAll(".duration-wheel-row")).map(
			(row) => row.textContent
		);

		expect(rows).toEqual(["23", "24", "25", "26", "27"]);
	});

	it("wraps the neighbours of a wrapping wheel round the ends", () => {
		const { container } = render(
			<DurationWheel
				label="seconds"
				unit="sec"
				value={0}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={() => {}}
			/>
		);

		const rows = Array.from(container.querySelectorAll(".duration-wheel-row")).map(
			(row) => row.textContent
		);

		expect(rows).toEqual(["58", "59", "00", "01", "02"]);
	});

	it("leaves blank rows past the ends of a wheel that does not wrap", () => {
		const { container } = render(
			<DurationWheel
				label="hours"
				unit="hr"
				value={0}
				min={0}
				max={3}
				wraps={false}
				pageStep={1}
				onChange={() => {}}
			/>
		);

		const rows = Array.from(container.querySelectorAll(".duration-wheel-row")).map(
			(row) => row.textContent
		);

		expect(rows).toEqual(["", "", "0", "1", "2"]);
	});

	it("goes up one on the up arrow", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(26);
	});

	it("goes down one on the down arrow", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowDown}");

		expect(onChange).toHaveBeenCalledWith(24);
	});

	it("comes round to 0 going up from the top of a wrapping wheel", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={59}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(0);
	});

	it("comes round to 59 going down from 0 on a wrapping wheel", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={0}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{ArrowDown}");

		expect(onChange).toHaveBeenCalledWith(59);
	});

	it("stops at the top of a wheel that does not wrap", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="hours"
				unit="hr"
				value={3}
				min={0}
				max={3}
				wraps={false}
				pageStep={1}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "hours" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(3);
	});

	it("moves by its page step on Page Up and Page Down", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{PageUp}");
		await user.keyboard("{PageDown}");

		expect(onChange).toHaveBeenNthCalledWith(1, 30);
		expect(onChange).toHaveBeenNthCalledWith(2, 20);
	});

	it("jumps to the smallest and largest value on Home and End", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("{Home}");
		await user.keyboard("{End}");

		expect(onChange).toHaveBeenNthCalledWith(1, 0);
		expect(onChange).toHaveBeenNthCalledWith(2, 59);
	});

	it("sets a two-digit value from two typed digits", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("4");
		await user.keyboard("5");

		expect(onChange).toHaveBeenNthCalledWith(1, 4);
		expect(onChange).toHaveBeenNthCalledWith(2, 45);
	});

	it("starts a new number when typed digits would pass the maximum", async () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("spinbutton", { name: "minutes" }).focus();
		await user.keyboard("7");
		await user.keyboard("2");

		expect(onChange).toHaveBeenNthCalledWith(1, 7);
		expect(onChange).toHaveBeenNthCalledWith(2, 2);
	});

	it("starts a new number when the digits were typed a while ago", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 14, 18, 0, 0));
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const wheel = screen.getByRole("spinbutton", { name: "minutes" });

		fireEvent.keyDown(wheel, { key: "1" });
		vi.setSystemTime(new Date(2026, 10, 14, 18, 0, 5));
		fireEvent.keyDown(wheel, { key: "2" });

		expect(onChange).toHaveBeenNthCalledWith(1, 1);
		expect(onChange).toHaveBeenNthCalledWith(2, 2);
	});

	it("goes up one on a mouse wheel notch down", () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);

		fireEvent.wheel(screen.getByRole("spinbutton", { name: "minutes" }), { deltaY: 100 });

		expect(onChange).toHaveBeenCalledWith(26);
	});

	it("goes down one on a mouse wheel notch up", () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);

		fireEvent.wheel(screen.getByRole("spinbutton", { name: "minutes" }), { deltaY: -100 });

		expect(onChange).toHaveBeenCalledWith(24);
	});

	it("waits for small trackpad movements to add up before stepping", () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const wheel = screen.getByRole("spinbutton", { name: "minutes" });

		fireEvent.wheel(wheel, { deltaY: 15 });
		fireEvent.wheel(wheel, { deltaY: 15 });
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.wheel(wheel, { deltaY: 15 });
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(26);
	});

	it("follows a drag upward, one step for each row travelled", () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const wheel = screen.getByRole("spinbutton", { name: "minutes" });

		fireEvent.pointerDown(wheel, { pointerId: 1, clientY: 200 });
		fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 140 });
		fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 140 });

		// 60px up is two 30px rows: 25 becomes 27.
		expect(onChange).toHaveBeenLastCalledWith(27);
	});

	it("follows a drag downward", () => {
		const onChange = vi.fn();
		render(
			<DurationWheel
				label="minutes"
				unit="min"
				value={25}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={onChange}
			/>
		);
		const wheel = screen.getByRole("spinbutton", { name: "minutes" });

		fireEvent.pointerDown(wheel, { pointerId: 1, clientY: 200 });
		fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 230 });
		fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 230 });

		expect(onChange).toHaveBeenLastCalledWith(24);
	});
});
