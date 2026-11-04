import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { animate, motion, useMotionValue } from "framer-motion";

/** Height of one row of the wheel, in CSS pixels. */
export const WHEEL_ROW_HEIGHT_PX = 30;
/** Rows shown: the selected one and two each side. */
const VISIBLE_ROWS = 5;
const ROWS_EACH_SIDE = 2;
/** A mouse wheel notch reports about 100; a trackpad sends many small deltas. */
const WHEEL_NOTCH_DELTA = 50;
const WHEEL_ACCUMULATED_DELTA = 40;
/** How long typed digits count as one number, in milliseconds. */
const DIGIT_BUFFER_MS = 1500;

export interface DurationWheelProps {
	/** What the wheel counts, such as "hours": its accessible name and the unit beside the value. */
	label: string;
	/** The short unit drawn beside the selected value, such as "hr". */
	unit: string;
	value: number;
	min: number;
	max: number;
	/** Whether scrolling past the last value comes round to the first, as minutes do. */
	wraps: boolean;
	/** How far PageUp and PageDown move the value. */
	pageStep: number;
	onChange: (value: number) => void;
}

/**
 * One column of an iOS-style picker: the selected value between its neighbours, moved by
 * dragging, the scroll wheel, the arrow keys, PageUp/PageDown, Home/End, or typing digits.
 * Exposed to assistive technology as a spin button.
 */
export function DurationWheel({
	label,
	unit,
	value,
	min,
	max,
	wraps,
	pageStep,
	onChange
}: DurationWheelProps) {
	const columnOffset = useMotionValue(0);
	const previousValueRef = useRef(value);
	const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
	const wheelAccumulatorRef = useRef(0);
	const typedDigitsRef = useRef({ digits: "", at: 0 });

	const span = max - min + 1;
	const normalize = (candidate: number) =>
		wraps
			? ((((candidate - min) % span) + span) % span) + min
			: Math.min(max, Math.max(min, candidate));

	// A change of value slides the column from where the old value was to rest.
	useEffect(() => {
		const change = value - previousValueRef.current;
		previousValueRef.current = value;
		if (change === 0 || dragRef.current) return;
		// Going through the wrap counts as one step, not a leap of 59.
		const stepped =
			wraps && Math.abs(change) > span / 2 ? change - Math.sign(change) * span : change;
		columnOffset.set(stepped * WHEEL_ROW_HEIGHT_PX);
		animate(columnOffset, 0, { type: "spring", stiffness: 520, damping: 38 });
	}, [value, wraps, span, columnOffset]);

	const step = (by: number) => onChange(normalize(value + by));

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const handled = (action: () => void) => {
			event.preventDefault();
			action();
		};
		if (event.key === "ArrowUp") return handled(() => step(1));
		if (event.key === "ArrowDown") return handled(() => step(-1));
		if (event.key === "PageUp") return handled(() => step(pageStep));
		if (event.key === "PageDown") return handled(() => step(-pageStep));
		if (event.key === "Home") return handled(() => onChange(min));
		if (event.key === "End") return handled(() => onChange(max));
		if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
			handled(() => {
				const now = Date.now();
				const typed = typedDigitsRef.current;
				const continued = now - typed.at < DIGIT_BUFFER_MS ? typed.digits : "";
				// A third digit, or one that would pass the maximum, starts a new number.
				const candidate = (continued + event.key).slice(-2);
				const digits = Number(candidate) > max ? event.key : candidate;
				typedDigitsRef.current = { digits, at: now };
				onChange(normalize(Number(digits)));
			});
		}
	};

	const onWheel = (event: WheelEvent<HTMLDivElement>) => {
		const delta = event.deltaY;
		if (Math.abs(delta) >= WHEEL_NOTCH_DELTA) {
			wheelAccumulatorRef.current = 0;
			step(Math.sign(delta));
			return;
		}
		wheelAccumulatorRef.current += delta;
		if (Math.abs(wheelAccumulatorRef.current) >= WHEEL_ACCUMULATED_DELTA) {
			step(Math.sign(wheelAccumulatorRef.current));
			wheelAccumulatorRef.current = 0;
		}
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { startY: event.clientY, startValue: value };
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		// Dragging up moves the column up, which brings later values into the middle.
		const travelled = drag.startY - event.clientY;
		const steps = Math.round(travelled / WHEEL_ROW_HEIGHT_PX);
		const next = normalize(drag.startValue + steps);
		if (next !== value) onChange(next);
		columnOffset.set(-(travelled - steps * WHEEL_ROW_HEIGHT_PX));
	};
	const endDrag = () => {
		if (!dragRef.current) return;
		dragRef.current = null;
		animate(columnOffset, 0, { type: "spring", stiffness: 520, damping: 38 });
	};

	const rows = [];
	for (let offset = -ROWS_EACH_SIDE; offset <= ROWS_EACH_SIDE; offset++) {
		const candidate = value + offset;
		const shown = wraps ? normalize(candidate) : candidate;
		const isOutOfRange = !wraps && (candidate < min || candidate > max);
		rows.push(
			<div
				key={offset}
				className={`duration-wheel-row distance-${Math.abs(offset)}`}
				aria-hidden="true"
			>
				{isOutOfRange ? "" : shown.toString().padStart(wraps ? 2 : 1, "0")}
			</div>
		);
	}

	return (
		<div
			className="duration-wheel"
			role="spinbutton"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={`${value} ${label}`}
			style={{ height: VISIBLE_ROWS * WHEEL_ROW_HEIGHT_PX }}
			onKeyDown={onKeyDown}
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<motion.div className="duration-wheel-column" style={{ y: columnOffset }}>
				{rows}
			</motion.div>
			<span className="duration-wheel-unit" aria-hidden="true">
				{unit}
			</span>
		</div>
	);
}
