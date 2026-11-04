import {
	useRef,
	useState,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type WheelEvent
} from "react";

/** One scroll-wheel notch or arrow key moves the level by this share of its range. */
const NUDGE_FRACTION = 0.05;
/** Page Up and Page Down move it by this share. */
const PAGE_FRACTION = 0.1;
/** Below this fill the icon sits on the bare track; above it the fill is under the icon. */
const ICON_COVERED_AT = 0.14;

export interface LevelSliderProps {
	"aria-label": string;
	value: number;
	min: number;
	max: number;
	/** The smallest change the level can make; values are rounded to it. */
	step: number;
	onChange: (value: number) => void;
	/** Drawn at the foot of the slider, like the speaker or sun in Apple's Control Center. */
	icon: ReactNode;
}

function decimalsOf(step: number): number {
	const text = step.toString();
	return text.includes(".") ? text.split(".")[1].length : 0;
}

/**
 * A tall slider that fills from the bottom, as in Apple's Control Center: press or drag
 * anywhere on it to set the level, scroll over it, or use the keyboard. The notch drags and
 * toggles on pointer events, so presses on the slider are kept from reaching it.
 */
export function LevelSlider({
	"aria-label": ariaLabel,
	value,
	min,
	max,
	step,
	onChange,
	icon
}: LevelSliderProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState(false);
	const span = max - min;
	const fraction = span === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / span));

	const snapped = (candidate: number) => {
		const clamped = Math.min(max, Math.max(min, candidate));
		const rounded = Math.round((clamped - min) / step) * step + min;
		return Number(Math.min(max, rounded).toFixed(decimalsOf(step)));
	};
	const setToFraction = (nextFraction: number) => onChange(snapped(min + nextFraction * span));
	const nudge = (byFraction: number) => setToFraction(fraction + byFraction);

	const setFromPointer = (clientY: number) => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect || rect.height === 0) return;
		setToFraction(1 - (clientY - rect.top) / rect.height);
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(true);
		setFromPointer(event.clientY);
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (dragging) setFromPointer(event.clientY);
	};
	const endDrag = () => setDragging(false);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const actions: Record<string, () => void> = {
			ArrowUp: () => nudge(NUDGE_FRACTION),
			ArrowRight: () => nudge(NUDGE_FRACTION),
			ArrowDown: () => nudge(-NUDGE_FRACTION),
			ArrowLeft: () => nudge(-NUDGE_FRACTION),
			PageUp: () => nudge(PAGE_FRACTION),
			PageDown: () => nudge(-PAGE_FRACTION),
			Home: () => onChange(snapped(min)),
			End: () => onChange(snapped(max))
		};
		const action = actions[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	};

	const onWheel = (event: WheelEvent<HTMLDivElement>) => {
		event.stopPropagation();
		if (event.deltaY === 0) return;
		nudge(event.deltaY < 0 ? NUDGE_FRACTION : -NUDGE_FRACTION);
	};

	return (
		<div
			ref={trackRef}
			className={`level-slider ${dragging ? "dragging" : ""}`}
			role="slider"
			tabIndex={0}
			aria-label={ariaLabel}
			aria-orientation="vertical"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={`${Math.round(fraction * 100)}%`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={onKeyDown}
			onWheel={onWheel}
		>
			<div className="level-fill" style={{ height: `${fraction * 100}%` }} />
			<span className="level-icon" data-covered={fraction > ICON_COVERED_AT} aria-hidden="true">
				{icon}
			</span>
		</div>
	);
}
