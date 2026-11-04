import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LevelSlider } from "./LevelSlider";

// jsdom has no layout, so give the slider a track 100px tall starting at the top of the page.
function giveTheTrackAHeightOf100px() {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
		top: 0,
		bottom: 100,
		left: 0,
		right: 40,
		width: 40,
		height: 100,
		x: 0,
		y: 0,
		toJSON: () => ({})
	});
}

describe("LevelSlider", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("is a vertical slider named for what it controls, with its range and value", () => {
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.4}
				min={0}
				max={1}
				step={0.01}
				onChange={() => {}}
				icon={null}
			/>
		);

		const slider = screen.getByRole("slider", { name: "Volume" });
		expect(slider).toHaveAttribute("aria-orientation", "vertical");
		expect(slider).toHaveAttribute("aria-valuemin", "0");
		expect(slider).toHaveAttribute("aria-valuemax", "1");
		expect(slider).toHaveAttribute("aria-valuenow", "0.4");
		expect(slider).toHaveAttribute("aria-valuetext", "40%");
	});

	it("fills to its value from the bottom", () => {
		const { container } = render(
			<LevelSlider
				aria-label="Brightness"
				value={25}
				min={0}
				max={100}
				step={1}
				onChange={() => {}}
				icon={null}
			/>
		);

		expect(container.querySelector<HTMLElement>(".level-fill")?.style.height).toBe("25%");
	});

	it("reports a value held to its range even if given one outside it", () => {
		const { container } = render(
			<LevelSlider
				aria-label="Volume"
				value={3}
				min={0}
				max={1}
				step={0.01}
				onChange={() => {}}
				icon={null}
			/>
		);

		expect(container.querySelector<HTMLElement>(".level-fill")?.style.height).toBe("100%");
	});

	it("draws the icon it is given", () => {
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.5}
				min={0}
				max={1}
				step={0.01}
				onChange={() => {}}
				icon={<svg data-testid="speaker" />}
			/>
		);

		expect(screen.getByTestId("speaker")).toBeInTheDocument();
	});

	it("puts the icon on the bare track when nearly empty and over the fill when higher", () => {
		const { container, rerender } = render(
			<LevelSlider
				aria-label="Volume"
				value={0.05}
				min={0}
				max={1}
				step={0.01}
				onChange={() => {}}
				icon={null}
			/>
		);
		expect(container.querySelector(".level-icon")).toHaveAttribute("data-covered", "false");

		rerender(
			<LevelSlider
				aria-label="Volume"
				value={0.6}
				min={0}
				max={1}
				step={0.01}
				onChange={() => {}}
				icon={null}
			/>
		);
		expect(container.querySelector(".level-icon")).toHaveAttribute("data-covered", "true");
	});

	it("sets the level where the track is pressed, measured from the bottom", () => {
		giveTheTrackAHeightOf100px();
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.2}
				min={0}
				max={1}
				step={0.01}
				onChange={onChange}
				icon={null}
			/>
		);

		fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, clientY: 25 });

		expect(onChange).toHaveBeenLastCalledWith(0.75);
	});

	it("follows a drag up and down the track", () => {
		giveTheTrackAHeightOf100px();
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.2}
				min={0}
				max={1}
				step={0.01}
				onChange={onChange}
				icon={null}
			/>
		);
		const slider = screen.getByRole("slider");

		fireEvent.pointerDown(slider, { pointerId: 1, clientY: 80 });
		fireEvent.pointerMove(slider, { pointerId: 1, clientY: 30 });
		expect(onChange).toHaveBeenLastCalledWith(0.7);

		fireEvent.pointerMove(slider, { pointerId: 1, clientY: 90 });
		expect(onChange).toHaveBeenLastCalledWith(0.1);
	});

	it("stops following once the pointer is released", () => {
		giveTheTrackAHeightOf100px();
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.2}
				min={0}
				max={1}
				step={0.01}
				onChange={onChange}
				icon={null}
			/>
		);
		const slider = screen.getByRole("slider");
		fireEvent.pointerDown(slider, { pointerId: 1, clientY: 50 });
		fireEvent.pointerUp(slider, { pointerId: 1, clientY: 50 });
		onChange.mockClear();

		fireEvent.pointerMove(slider, { pointerId: 1, clientY: 10 });

		expect(onChange).not.toHaveBeenCalled();
	});

	it("holds a press above or below the track to the ends of the range", () => {
		giveTheTrackAHeightOf100px();
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const slider = screen.getByRole("slider");

		fireEvent.pointerDown(slider, { pointerId: 1, clientY: -40 });
		expect(onChange).toHaveBeenLastCalledWith(100);

		fireEvent.pointerMove(slider, { pointerId: 1, clientY: 400 });
		expect(onChange).toHaveBeenLastCalledWith(0);
	});

	it("rounds to its step", () => {
		giveTheTrackAHeightOf100px();
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={10}
				onChange={onChange}
				icon={null}
			/>
		);

		fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, clientY: 63 });

		expect(onChange).toHaveBeenLastCalledWith(40);
	});

	it("goes up by a twentieth of its range on the up arrow and down on the down arrow", async () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("slider").focus();
		await user.keyboard("{ArrowUp}");
		await user.keyboard("{ArrowDown}");

		expect(onChange).toHaveBeenNthCalledWith(1, 55);
		expect(onChange).toHaveBeenNthCalledWith(2, 45);
	});

	it("moves a tenth of its range on Page Up and Page Down", async () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("slider").focus();
		await user.keyboard("{PageUp}");
		await user.keyboard("{PageDown}");

		expect(onChange).toHaveBeenNthCalledWith(1, 60);
		expect(onChange).toHaveBeenNthCalledWith(2, 40);
	});

	it("jumps to the ends on Home and End", async () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("slider").focus();
		await user.keyboard("{Home}");
		await user.keyboard("{End}");

		expect(onChange).toHaveBeenNthCalledWith(1, 0);
		expect(onChange).toHaveBeenNthCalledWith(2, 100);
	});

	it("does not run past the top on the up arrow", async () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={100}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("slider").focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(100);
	});

	it("keeps clean decimals for a fine step", async () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Volume"
				value={0.3}
				min={0}
				max={1}
				step={0.01}
				onChange={onChange}
				icon={null}
			/>
		);
		const user = userEvent.setup();

		screen.getByRole("slider").focus();
		await user.keyboard("{ArrowUp}");

		expect(onChange).toHaveBeenCalledWith(0.35);
	});

	it("goes up when the mouse wheel scrolls up and down when it scrolls down", () => {
		const onChange = vi.fn();
		render(
			<LevelSlider
				aria-label="Brightness"
				value={50}
				min={0}
				max={100}
				step={1}
				onChange={onChange}
				icon={null}
			/>
		);
		const slider = screen.getByRole("slider");

		fireEvent.wheel(slider, { deltaY: -100 });
		fireEvent.wheel(slider, { deltaY: 100 });

		expect(onChange).toHaveBeenNthCalledWith(1, 55);
		expect(onChange).toHaveBeenNthCalledWith(2, 45);
	});

	it("keeps pointer presses, clicks and scrolls from reaching the notch around it", () => {
		giveTheTrackAHeightOf100px();
		const notchPointerDown = vi.fn();
		const notchClick = vi.fn();
		const notchWheel = vi.fn();
		render(
			<div onPointerDown={notchPointerDown} onClick={notchClick} onWheel={notchWheel}>
				<LevelSlider
					aria-label="Volume"
					value={0.5}
					min={0}
					max={1}
					step={0.01}
					onChange={() => {}}
					icon={null}
				/>
			</div>
		);
		const slider = screen.getByRole("slider");

		fireEvent.pointerDown(slider, { pointerId: 1, clientY: 50 });
		fireEvent.click(slider);
		fireEvent.wheel(slider, { deltaY: 100 });

		expect(notchPointerDown).not.toHaveBeenCalled();
		expect(notchClick).not.toHaveBeenCalled();
		expect(notchWheel).not.toHaveBeenCalled();
	});
});
