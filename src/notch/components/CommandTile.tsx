import type { MouseEvent, ReactNode } from "react";
import { ChevronRight } from "../../icons/glyphs";

export interface CommandTileProps {
	icon: ReactNode;
	title: string;
	/** One short line under the title: "Off", a network name, "Fixed". */
	status: string;
	/** The colour of the lit tile: the theme accent, or green for power saving. */
	tone?: "accent" | "green";
	/** Whether the thing is on. Leave out for a tile that only opens something. */
	pressed?: boolean;
	/** Whether the tile shows as lit. Defaults to `pressed`. */
	lit?: boolean;
	onPress: (event: MouseEvent) => void;
	/** Right-click, for the view behind the tile (networks, devices). */
	onSecondaryPress?: (event: MouseEvent) => void;
	/** A chevron that opens the view behind the tile. */
	more?: { label: string; onPress: () => void };
	/** The tooltip, saying what a click does. */
	hint?: string;
	/** What assistive technology reads for the tile; defaults to the title and the status. */
	label?: string;
}

/**
 * A rounded Control Center tile: an icon, a title and a line of status. The whole tile is
 * one button; a second, separate button in its corner opens the view behind it, because
 * buttons cannot be nested.
 */
export function CommandTile({
	icon,
	title,
	status,
	tone = "accent",
	pressed,
	lit = pressed === true,
	onPress,
	onSecondaryPress,
	more,
	hint,
	label
}: CommandTileProps) {
	return (
		<div className={`cc-tile cc-tile--${tone} ${lit ? "lit" : ""}`}>
			<button
				type="button"
				className="cc-tile-main"
				aria-pressed={pressed}
				aria-label={label ?? `${title}, ${status}`}
				title={hint}
				onClick={(event) => {
					event.stopPropagation();
					onPress(event);
				}}
				onContextMenu={onSecondaryPress}
			>
				<span className="cc-tile-icon" aria-hidden="true">
					{icon}
				</span>
				<span className="cc-tile-text">
					<span className="cc-tile-title">{title}</span>
					<span className="cc-tile-status">{status}</span>
				</span>
			</button>
			{more && (
				<button
					type="button"
					className="cc-tile-more"
					aria-label={more.label}
					title={more.label}
					onClick={(event) => {
						event.stopPropagation();
						more.onPress();
					}}
				>
					<ChevronRight size={12} strokeWidth={2.4} />
				</button>
			)}
		</div>
	);
}
