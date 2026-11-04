import { Slider } from "glisse";
import { useSettingRowLabel } from "./SettingRow";

interface SettingSliderProps {
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}

/**
 * A numeric setting drawn as a Liquid Glass slider. Inside a SettingRow it is named
 * after that row's label; the width is fixed so every row's control lines up.
 */
export function SettingSlider({ value, min, max, step, onChange }: SettingSliderProps) {
	const rowLabel = useSettingRowLabel();

	return (
		<Slider
			className="settings-slider"
			aria-label={rowLabel}
			value={value}
			min={min}
			max={max}
			step={step}
			onValueChange={onChange}
		/>
	);
}
