import { motion } from "framer-motion";

export interface PanelSwitcherItem<Value extends string> {
	value: Value;
	label: string;
	/** Shown after the label, such as the time left on a running timer. */
	badge?: string;
	/** Marks the item as needing attention (a timer that has finished). */
	alert?: boolean;
}

export interface PanelSwitcherProps<Value extends string> {
	"aria-label": string;
	items: PanelSwitcherItem<Value>[];
	value: Value;
	onValueChange: (value: Value) => void;
}

/**
 * A segmented control that switches between the views of a panel: a track with a thumb
 * that slides under the selected segment, like the segmented controls in Apple's apps.
 */
export function PanelSwitcher<Value extends string>({
	"aria-label": ariaLabel,
	items,
	value,
	onValueChange
}: PanelSwitcherProps<Value>) {
	return (
		<div className="panel-switcher" role="tablist" aria-label={ariaLabel}>
			{items.map((item) => {
				const selected = item.value === value;
				return (
					<button
						key={item.value}
						type="button"
						role="tab"
						aria-selected={selected}
						className={`panel-switcher-segment ${selected ? "selected" : ""}`}
						onClick={() => onValueChange(item.value)}
					>
						{selected && (
							<motion.span
								layoutId="panel-switcher-thumb"
								className="panel-switcher-thumb"
								transition={{ type: "spring", stiffness: 520, damping: 40 }}
							/>
						)}
						<span className="panel-switcher-label">
							{item.label}
							{item.badge && (
								<>
									{/* The gap is drawn by CSS, so assistive technology needs a real space. */}{" "}
									<span className={`panel-switcher-badge ${item.alert ? "alert" : ""}`}>
										{item.badge}
									</span>
								</>
							)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
