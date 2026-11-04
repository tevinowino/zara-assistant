import type { ClockParts } from "./clockParts";

/** The notch's clock: the digits large, and a small, quiet AM or PM beside them. */
export function ClockFace({ time, dayPeriod }: ClockParts) {
	return (
		<>
			<span className="clock-digits">{time}</span>
			{dayPeriod && <span className="clock-period">{dayPeriod}</span>}
		</>
	);
}
