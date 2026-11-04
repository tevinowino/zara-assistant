import { VenetianMask } from "../../icons/glyphs";

export interface StealthRimProps {
	/** True when Zara's windows are confirmed hidden; false when stealth was asked for but is not holding. */
	active: boolean;
}

/**
 * A fine dotted rim just inside the notch's edge, drawn while stealth mode is on. It is
 * deliberately not a dashed outline: the shelf already marks a file being dragged over the
 * notch with one. Violet when stealth is holding, amber when it was asked for and is not.
 * Render it inside the notch, which gives it its corner radii.
 */
export function StealthRim({ active }: StealthRimProps) {
	return (
		<span className="stealth-rim" data-state={active ? "active" : "problem"} aria-hidden="true" />
	);
}

export interface StealthBadgeProps {
	active: boolean;
	/** Why stealth is not holding, when it was asked for and is not. */
	problem: string | null;
}

/** A small mask beside the clock that says stealth mode is on, for anyone who misses the rim. */
export function StealthBadge({ active, problem }: StealthBadgeProps) {
	const label = active
		? "Stealth mode is on: Zara is hidden from screen capture"
		: `Stealth mode is on but not holding${problem ? `: ${problem}` : ""}`;

	return (
		<span
			className="stealth-badge"
			data-state={active ? "active" : "problem"}
			role="img"
			aria-label={label}
			title={label}
		>
			<VenetianMask size={12} strokeWidth={2} />
		</span>
	);
}
