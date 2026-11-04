import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotchSlider } from "./NotchSlider";

describe("NotchSlider", () => {
	it("reports the new value as a number", () => {
		const onChange = vi.fn();
		render(
			<NotchSlider
				aria-label="Volume"
				min={0}
				max={1}
				step={0.01}
				value={0.5}
				onChange={onChange}
			/>
		);

		fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
			target: { value: "0.75" }
		});

		expect(onChange).toHaveBeenCalledWith(0.75);
	});

	it("keeps presses from reaching the notch around it", () => {
		const notchPointerDown = vi.fn();
		const notchClick = vi.fn();
		render(
			<div onPointerDown={notchPointerDown} onClick={notchClick}>
				<NotchSlider
					aria-label="Brightness"
					min={0}
					max={100}
					step={1}
					value={40}
					onChange={() => {}}
				/>
			</div>
		);
		const slider = screen.getByRole("slider", { name: "Brightness" });

		fireEvent.pointerDown(slider);
		fireEvent.click(slider);

		expect(notchPointerDown).not.toHaveBeenCalled();
		expect(notchClick).not.toHaveBeenCalled();
	});
});
