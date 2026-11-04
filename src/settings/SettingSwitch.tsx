import { Switch } from "glisse";
import { useSettingRowLabel } from "./SettingRow";

interface SettingSwitchProps {
	checked: boolean;
	/** Flip the setting. Settings own their current value, so this takes no argument. */
	onToggle: () => void;
	disabled?: boolean;
	/** Tooltip, e.g. to explain why the switch is disabled. */
	title?: string;
	/** Overrides the name taken from the enclosing SettingRow. */
	"aria-label"?: string;
}

/**
 * The on/off control for a setting, drawn as Liquid Glass. Inside a SettingRow it
 * is named after that row's label.
 */
export function SettingSwitch({
	checked,
	onToggle,
	disabled,
	title,
	"aria-label": ariaLabel
}: SettingSwitchProps) {
	const rowLabel = useSettingRowLabel();

	return (
		<Switch
			checked={checked}
			onCheckedChange={() => onToggle()}
			disabled={disabled}
			title={title}
			aria-label={ariaLabel ?? rowLabel}
		/>
	);
}
