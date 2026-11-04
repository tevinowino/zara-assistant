import { Zap } from "../../icons/glyphs";
import type { BudLevel, BudsBattery } from "../../devices/connectedDevices";

/** A small ring showing a device's battery, with the level in the middle. */
export function DeviceBatteryRing({
	level,
	charging = false
}: {
	level: number;
	charging?: boolean;
}) {
	const r = 10.5;
	const circumference = 2 * Math.PI * r;
	const low = level <= 20 && !charging;
	return (
		<div
			className={`device-alert-battery${low ? " low" : ""}${charging ? " charging" : ""}`}
			title={`${level}%${charging ? ", charging" : ""}`}
		>
			<svg viewBox="0 0 28 28" width="28" height="28">
				<circle cx="14" cy="14" r={r} className="track" />
				<circle
					cx="14"
					cy="14"
					r={r}
					className="level"
					strokeDasharray={`${(circumference * level) / 100} ${circumference}`}
					transform="rotate(-90 14 14)"
				/>
			</svg>
			<span>{level}</span>
		</div>
	);
}

// Each bud's and the case's battery, for earbuds that report them: a ring
// per part with its label underneath. Parts with no reading are left out.
export function DeviceBudsBattery({ buds }: { buds: BudsBattery }) {
	const parts: [string, BudLevel][] = [];
	if (buds.left) parts.push(["L", buds.left]);
	if (buds.right) parts.push(["R", buds.right]);
	if (buds.case) parts.push(["Case", buds.case]);
	return (
		<div className="device-alert-buds">
			{parts.map(([label, part]) => (
				<div key={label} className="device-alert-bud">
					<DeviceBatteryRing level={part.level} charging={part.charging} />
					<span className="device-alert-bud-label">
						{label}
						{part.charging && <Zap className="device-alert-bud-charging" />}
					</span>
				</div>
			))}
		</div>
	);
}
