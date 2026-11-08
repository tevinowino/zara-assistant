import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Laptop, LoaderCircle, MonitorSmartphone, Zap } from "../icons/glyphs";
import { DeviceArt } from "../devices/DeviceArt";
import { deviceArtFor } from "../devices/deviceArtFor";
import {
	DEVICE_LOOKS,
	WIRED_DEVICE_LOOKS,
	deviceLookFor,
	setDeviceLook
} from "../devices/deviceLooks";
import { isWiredAudio, usbArtFor, usbDisplayName } from "../devices/usbArtFor";
import {
	cardShapeInGroup,
	groupDevices,
	urgentLevel,
	type BudLevel,
	type BudsBattery,
	type DeviceEntry
} from "../devices/connectedDevices";
import type { ConnectedDevicesState, PcBattery } from "../hooks/useConnectedDevices";
import "./QuickPanel.css";
import "./ConnectedDevices.css";

interface ConnectedDevicesPanelProps {
	data: ConnectedDevicesState;
	/** Final notch height, independent of the shell's expansion animation. */
	height: number;
	/** Each bud's and the case's level, by device id, as last reported. */
	buds: Record<string, BudsBattery>;
	/** The user's low battery threshold, in percent. */
	lowThreshold: number;
	/**
	 * Called with the notch height the panel's content needs, so the notch can
	 * grow with the list (up to its limit) instead of keeping a fixed size.
	 */
	onContentHeight?: (height: number) => void;
}

/** The width of the notch while it shows the connected devices: two tiles side by side. */
export const DEVICES_PANEL_WIDTH_PX = 392;

/** Room for the loading spinner or the empty message. */
const EMPTY_BODY_HEIGHT = 72;

function duration(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function pcStatus(pc: PcBattery): string {
	if (pc.charging)
		return pc.seconds_to_full ? `Charging · ${duration(pc.seconds_to_full)} to full` : "Charging";
	if (pc.plugged_in) return "Plugged in";
	return pc.seconds_left ? `${duration(pc.seconds_left)} left` : "On battery";
}

/**
 * One battery level: its percent over a bar that fills to it. The bar is the text colour,
 * green while charging and red when low, as on the command center's sliders. Described
 * once, in words, so assistive technology does not read the percent twice.
 */
function Level({
	part,
	low,
	label,
	large
}: {
	part: BudLevel;
	low: boolean;
	label?: string;
	large?: boolean;
}) {
	const state = part.charging ? " charging" : low ? " low" : "";
	return (
		<div
			className={`cd-level${state}${large ? " large" : ""}`}
			role="img"
			aria-label={`${label ? `${label}, ` : ""}${part.level}%${part.charging ? ", charging" : low ? ", low" : ""}`}
		>
			<span className="cd-level-value" aria-hidden="true">
				{label && <span className="cd-level-label">{label}</span>}
				{part.charging && <Zap className="cd-level-bolt" />}
				{part.level}
				<span className="cd-level-unit">%</span>
			</span>
			<span className="cd-level-bar" aria-hidden="true">
				<span style={{ width: `${Math.max(4, part.level)}%` }} />
			</span>
		</div>
	);
}

/**
 * Connected devices: everything connected to the computer, Bluetooth and
 * wired, with its battery by priority. Devices that need charging come
 * first, then this PC, audio, phones and watches, accessories, drives and
 * cameras, and the rest. An audio device's row opens its "Looks like"
 * choice, the drawing its connection popup uses, which wired devices have no
 * other place to set.
 */
export function ConnectedDevicesPanel({
	data,
	height,
	buds,
	lowThreshold,
	onContentHeight
}: ConnectedDevicesPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const headerRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const reportedHeight = useRef(0);
	const { devices, wired, pc } = data;
	const [expanded, setExpanded] = useState<string | null>(null);
	// Bumped when a look is picked, so the rows draw the new pick.
	const [looksVersion, setLooksVersion] = useState(0);

	useEffect(() => {
		// Earbuds' own levels go stale; read them again (the backend skips
		// any read in the last minute and a half).
		invoke("bluetooth_refresh_buds").catch(() => {});
	}, []);

	const guessFor = useCallback(
		(entry: DeviceEntry) => {
			if (entry.wired) {
				const device = wired.find((d) => d.id === entry.id);
				return device ? usbArtFor(device) : null;
			}
			const device = devices?.find((d) => d.id === entry.id);
			return device ? deviceArtFor(device) : null;
		},
		[devices, wired]
	);

	const groups = useMemo(() => {
		const entries: DeviceEntry[] = [];
		if (pc?.present && pc.percent !== null) {
			entries.push({
				id: "pc",
				name: "This PC",
				kind: "pc",
				wired: false,
				art: null,
				level: pc.percent,
				charging: pc.charging,
				buds: null
			});
		}
		for (const d of devices ?? []) {
			if (!d.connected) continue;
			entries.push({
				id: d.id,
				name: d.name,
				kind: d.kind,
				wired: false,
				art: deviceLookFor(d.name) ?? deviceArtFor(d),
				level: d.battery,
				charging: false,
				buds: buds[d.id] ?? null
			});
		}
		for (const d of wired) {
			const name = usbDisplayName(d);
			const audio = isWiredAudio(d.class);
			entries.push({
				id: d.id,
				name,
				kind: audio ? "audio" : "usb",
				wired: true,
				art: (audio ? deviceLookFor(name) : null) ?? usbArtFor(d),
				level: null,
				charging: false,
				buds: null
			});
		}
		return groupDevices(entries, lowThreshold);
		// looksVersion: a new pick is read from the setting.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [devices, wired, pc, buds, lowThreshold, looksVersion]);

	const isLow = (part: BudLevel) => !part.charging && part.level <= lowThreshold;

	const renderLevels = (entry: DeviceEntry) => {
		if (entry.buds) {
			const parts: [string, BudLevel][] = [];
			if (entry.buds.left) parts.push(["L", entry.buds.left]);
			if (entry.buds.right) parts.push(["R", entry.buds.right]);
			if (entry.buds.case) parts.push(["Case", entry.buds.case]);
			return (
				<div className="cd-levels">
					{parts.map(([label, part]) => (
						<Level key={label} label={label} part={part} low={isLow(part)} />
					))}
				</div>
			);
		}
		if (entry.level === null) return null;
		const part = { level: entry.level, charging: entry.charging };
		return <Level part={part} low={isLow(part)} large />;
	};

	const subText = (entry: DeviceEntry) => {
		if (entry.kind === "pc" && pc) return pcStatus(pc);
		if (entry.wired) return entry.id === "jack" ? "Headphone jack" : "USB";
		if (entry.level === null && !entry.buds) return "Connected \u00b7 no battery info";
		return "Connected";
	};

	// The drawing an audio device's popup uses. Picking what Zara would
	// guess anyway clears the pick, so a later, better guess still applies.
	const renderLooks = (entry: DeviceEntry) => {
		const looks = entry.wired ? WIRED_DEVICE_LOOKS : DEVICE_LOOKS;
		const guess = guessFor(entry);
		return (
			<div className="qp-chips cd-looks" role="radiogroup" aria-label="Looks like">
				<span className="qp-note">Looks like</span>
				{looks.map((look) => (
					<button
						key={look.art}
						className={`qp-chip ${entry.art === look.art ? "on" : ""}`}
						role="radio"
						aria-checked={entry.art === look.art}
						onClick={() => {
							setDeviceLook(entry.name, look.art === guess ? null : look.art);
							setLooksVersion((v) => v + 1);
						}}
					>
						{look.label}
					</button>
				))}
			</div>
		);
	};

	const loading = devices === null;
	const empty = !loading && groups.length === 0;

	// The height the notch needs to show everything: the panel's offset and
	// padding, the header, the gap, and the list's full (unclipped) height.
	const measureContent = useCallback(() => {
		const panel = panelRef.current;
		if (!panel || !onContentHeight) return;
		const style = getComputedStyle(panel);
		const body = listRef.current ? listRef.current.scrollHeight : EMPTY_BODY_HEIGHT;
		const height = Math.ceil(
			panel.offsetTop +
				parseFloat(style.paddingTop) +
				(headerRef.current?.offsetHeight ?? 0) +
				(parseFloat(style.rowGap) || 0) +
				body +
				parseFloat(style.paddingBottom)
		);
		if (height === reportedHeight.current) return;
		reportedHeight.current = height;
		onContentHeight(height);
	}, [onContentHeight]);

	useLayoutEffect(measureContent);

	// Rows also change size on their own (a row's "Looks like" choice opening),
	// so watch the list and each group as well as re-measuring on render.
	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const observer = new ResizeObserver(measureContent);
		observer.observe(list);
		for (const group of Array.from(list.children)) observer.observe(group);
		return () => observer.disconnect();
	});

	const connectedCount = groups.reduce((total, group) => total + group.entries.length, 0);
	const lowestLevel = groups
		.flatMap((group) => group.entries)
		.map(urgentLevel)
		.filter((level): level is number => level !== null)
		.reduce<number | null>((lowest, level) => (lowest === null ? level : Math.min(lowest, level)), null);

	// Lay out against the final height; the expanding shell clips the reveal.
	// Otherwise its intermediate heights briefly make a fitting list scroll.
	return (
		<div
			ref={panelRef}
			className="qp cd"
			style={{ height: height - 36 }}
			onClick={(e) => e.stopPropagation()}
		>
			<div ref={headerRef} className="cd-header">
				<span className="cd-header-icon">
					<MonitorSmartphone />
				</span>
				<span className="cd-title">Connected devices</span>
				{connectedCount > 0 && (
					<span className="cd-summary">
						{connectedCount} connected
						{lowestLevel !== null && lowestLevel <= lowThreshold ? ` \u00b7 ${lowestLevel}% low` : ""}
					</span>
				)}
			</div>
			<div className="qp-body">
				{loading ? (
					<div className="qp-empty">
						<LoaderCircle className="qp-spin" />
					</div>
				) : empty ? (
					<div className="qp-empty">
						<MonitorSmartphone />
						<span>No devices connected</span>
					</div>
				) : (
					<div ref={listRef} className="qp-list cd-list">
						{groups.map((group) => (
							<section key={group.key} className={`cd-group ${group.key}`}>
								{/* The PC's card says what it is; a title above it would only repeat it. */}
								{group.key !== "pc" && <h3 className="cd-group-title">{group.title}</h3>}
								<ul className="cd-grid">
									{group.entries.map((entry) => {
										const lookable = entry.kind === "audio";
										const open = lookable && expanded === entry.id;
										const shape = open ? "wide" : cardShapeInGroup(entry, group.entries);
										const low = urgentLevel(entry) !== null && urgentLevel(entry)! <= lowThreshold;
										const main = (
											<>
												<span className="cd-art">
													{entry.art ? (
														<DeviceArt art={entry.art} phase="play" runId={0} size={36} still />
													) : (
														<Laptop />
													)}
												</span>
												<span className="cd-text">
													<span className="cd-name">{entry.name}</span>
													<span className="cd-sub">{subText(entry)}</span>
												</span>
												{renderLevels(entry)}
											</>
										);
										return (
											<li
												key={entry.id}
												className={`cd-card cd-card--${shape}${low ? " low" : ""}${open ? " expanded" : ""}`}
											>
												{lookable ? (
													<button
														className="cd-card-main"
														aria-expanded={open}
														onClick={() => setExpanded(open ? null : entry.id)}
													>
														{main}
													</button>
												) : (
													<div className="cd-card-main">{main}</div>
												)}
												{open && renderLooks(entry)}
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
