import { DurationWheel } from "./DurationWheel";
import { MAX_TIMER_SECONDS, partsToSeconds, secondsToParts } from "../timer/timerFormat";

const MAX_HOURS = MAX_TIMER_SECONDS / 3600;

export interface DurationWheelsProps {
	seconds: number;
	/** Called with the new duration, already held to the timer limit. */
	onChange: (seconds: number) => void;
}

/** Hours, minutes and seconds wheels side by side, like the iOS Clock timer. */
export function DurationWheels({ seconds, onChange }: DurationWheelsProps) {
	const parts = secondsToParts(seconds);

	return (
		<div className="duration-wheels" role="group" aria-label="Timer duration">
			<div className="duration-wheel-selection" aria-hidden="true" />
			<DurationWheel
				label="hours"
				unit="hr"
				value={parts.hours}
				min={0}
				max={MAX_HOURS}
				wraps={false}
				pageStep={1}
				onChange={(hours) => onChange(partsToSeconds({ ...parts, hours }))}
			/>
			<DurationWheel
				label="minutes"
				unit="min"
				value={parts.minutes}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={(minutes) => onChange(partsToSeconds({ ...parts, minutes }))}
			/>
			<DurationWheel
				label="seconds"
				unit="sec"
				value={parts.seconds}
				min={0}
				max={59}
				wraps
				pageStep={5}
				onChange={(secs) => onChange(partsToSeconds({ ...parts, seconds: secs }))}
			/>
		</div>
	);
}
