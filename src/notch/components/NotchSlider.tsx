import { Slider } from "glisse";

interface NotchSliderProps {
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	"aria-label": string;
}

/**
 * A Liquid Glass slider for the notch's control rows. The notch drags and toggles on
 * pointer events, so presses on the slider must not reach it. The glass slider is
 * taller than a row; the CSS lines its track up with the row and lets the thumb overhang.
 */
export function NotchSlider({
	value,
	min,
	max,
	step,
	onChange,
	"aria-label": ariaLabel
}: NotchSliderProps) {
	return (
		<div
			className="notch-glass-slider"
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
		>
			<Slider
				aria-label={ariaLabel}
				value={value}
				min={min}
				max={max}
				step={step}
				onValueChange={onChange}
			/>
		</div>
	);
}
