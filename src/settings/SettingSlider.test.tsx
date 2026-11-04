import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Contrast } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { SettingSlider } from "./SettingSlider";

describe("SettingSlider", () => {
	it("is named after the setting row it sits in", () => {
		render(
			<SettingRow icon={Contrast} label="Background Opacity">
				<SettingSlider min={0.1} max={1} step={0.05} value={0.8} onChange={() => {}} />
			</SettingRow>
		);

		expect(screen.getByRole("slider", { name: "Background Opacity" })).toBeInTheDocument();
	});

	it("shows the current value", () => {
		render(
			<SettingRow icon={Contrast} label="Peek Delay">
				<SettingSlider min={0} max={800} step={50} value={300} onChange={() => {}} />
			</SettingRow>
		);

		expect(screen.getByRole("slider", { name: "Peek Delay" })).toHaveValue("300");
	});

	it("reports the new value as a number", () => {
		const onChange = vi.fn();
		render(
			<SettingRow icon={Contrast} label="Peek Delay">
				<SettingSlider min={0} max={800} step={50} value={300} onChange={onChange} />
			</SettingRow>
		);

		fireEvent.change(screen.getByRole("slider", { name: "Peek Delay" }), {
			target: { value: "450" }
		});

		expect(onChange).toHaveBeenCalledWith(450);
	});
});
