import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, Lightbulb, XCircle } from "lucide-react";
import { ACCENT_HEX, type AccentName } from "../protocol/accent";

// The coloured display components of a surface: badge, callout, progress bar,
// ring, key-value list, timeline and checklist. Each colour is a palette name
// (protocol/accent.ts) set as the `--zai-accent` custom property, which the
// stylesheet turns into tints and borders; the text itself keeps the notch's own
// colour, so an unusual hue can never make something unreadable.

type AccentStyle = CSSProperties & { "--zai-accent"?: string };

/** The style that gives an element its accent colour; none when no colour was chosen. */
export function accentStyle(color: AccentName | undefined): AccentStyle | undefined {
	return color ? { "--zai-accent": ACCENT_HEX[color] } : undefined;
}

/** A number from the surface, kept inside 0 to 100; anything that is not a number is 0. */
export function clampPercent(value: unknown): number {
	const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return Math.min(100, Math.max(0, Math.round(number)));
}

export function Badge({ label, color }: { label: string; color?: AccentName }) {
	return (
		<span className="zai-s-badge" style={accentStyle(color)}>
			{label}
		</span>
	);
}

const TONE_STYLE = {
	info: { color: "blue", Icon: Info },
	success: { color: "green", Icon: CheckCircle2 },
	warning: { color: "amber", Icon: AlertTriangle },
	error: { color: "red", Icon: XCircle },
	tip: { color: "purple", Icon: Lightbulb }
} as const satisfies Record<string, { color: AccentName; Icon: typeof Info }>;

export function Callout({
	tone,
	title,
	text
}: {
	tone: keyof typeof TONE_STYLE;
	title?: string;
	text: string;
}) {
	const { color, Icon } = TONE_STYLE[tone];
	return (
		<div className="zai-s-callout" role="note" style={accentStyle(color)}>
			<Icon size={15} aria-hidden="true" className="zai-s-callout-icon" />
			<div className="zai-s-callout-body">
				{title && <span className="zai-s-callout-title">{title}</span>}
				<span className="zai-s-callout-text">{text}</span>
			</div>
		</div>
	);
}

interface MeterProps {
	label?: string;
	caption?: string;
	percent: number;
	color?: AccentName;
}

export function Progress({ label, caption, percent, color }: MeterProps) {
	return (
		<div className="zai-s-progress" style={accentStyle(color)}>
			<div className="zai-s-progress-head">
				{label && <span className="zai-s-progress-label">{label}</span>}
				<span className="zai-s-progress-value">{`${percent}%`}</span>
			</div>
			<div
				className="zai-s-progress-track"
				role="progressbar"
				aria-label={label ?? "Progress"}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
			>
				<div className="zai-s-progress-fill" style={{ width: `${percent}%` }} />
			</div>
			{caption && <span className="zai-s-caption">{caption}</span>}
		</div>
	);
}

const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function Ring({ label, caption, percent, color }: MeterProps) {
	return (
		<div className="zai-s-ring" style={accentStyle(color)}>
			<div
				className="zai-s-ring-dial"
				role="progressbar"
				aria-label={label ?? "Progress"}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
			>
				<svg viewBox="0 0 64 64" aria-hidden="true">
					<circle className="zai-s-ring-track" cx="32" cy="32" r={RING_RADIUS} />
					<circle
						className="zai-s-ring-fill"
						cx="32"
						cy="32"
						r={RING_RADIUS}
						strokeDasharray={RING_CIRCUMFERENCE}
						strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
					/>
				</svg>
				<span className="zai-s-ring-value">{`${percent}%`}</span>
			</div>
			{label && <span className="zai-s-ring-label">{label}</span>}
			{caption && <span className="zai-s-caption">{caption}</span>}
		</div>
	);
}

interface KeyValueItem {
	label: string;
	value: string;
	color?: AccentName;
}

export function KeyValue({ items }: { items: KeyValueItem[] }) {
	return (
		<dl className="zai-s-keyvalue">
			{items.map((item, index) => (
				<div key={index} className="zai-s-keyvalue-row">
					<dt>{item.label}</dt>
					<dd style={accentStyle(item.color)} data-accent={item.color ? "true" : undefined}>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

interface TimelineItem {
	title: string;
	time?: string;
	description?: string;
	color?: AccentName;
}

export function Timeline({ items }: { items: TimelineItem[] }): ReactNode {
	return (
		<ol className="zai-s-timeline">
			{items.map((item, index) => (
				<li key={index} className="zai-s-timeline-item" style={accentStyle(item.color)}>
					<span className="zai-s-timeline-dot" aria-hidden="true" />
					<div className="zai-s-timeline-body">
						<div className="zai-s-timeline-head">
							<span className="zai-s-timeline-title">{item.title}</span>
							{item.time && <span className="zai-s-timeline-time">{item.time}</span>}
						</div>
						{item.description && <span className="zai-s-caption">{item.description}</span>}
					</div>
				</li>
			))}
		</ol>
	);
}

interface ChecklistItem {
	text: string;
	done?: boolean;
}

export function Checklist({ items }: { items: ChecklistItem[] }) {
	return (
		<ul className="zai-s-checklist">
			{items.map((item, index) => (
				<li key={index} className="zai-s-checklist-item" data-done={item.done ? "true" : "false"}>
					{item.done ? (
						<CheckCircle2 size={14} aria-hidden="true" className="zai-s-check-done" />
					) : (
						<Circle size={14} aria-hidden="true" className="zai-s-check-todo" />
					)}
					<span>{item.text}</span>
					<span className="zai-s-visually-hidden">{item.done ? "Done" : "To do"}</span>
				</li>
			))}
		</ul>
	);
}
