import { createContext, useContext } from "react";
import type { SettingRowProps } from "./types";

/**
 * The label of the SettingRow a control is rendered inside, so controls such as
 * SettingSwitch get an accessible name without every call site repeating it.
 */
const SettingRowLabelContext = createContext<string | undefined>(undefined);

export function useSettingRowLabel(): string | undefined {
	return useContext(SettingRowLabelContext);
}

export function SettingRow({
	icon: Icon,
	label,
	desc,
	action,
	danger,
	divider = true,
	onClick,
	children
}: SettingRowProps) {
	const className = ["setting-item", action ? "action" : "", danger ? "danger" : ""]
		.filter(Boolean)
		.join(" ");

	return (
		<>
			<div className={className} onClick={onClick}>
				<div className="setting-icon-bg">
					<Icon size={14} strokeWidth={1.5} />
				</div>
				<div className="setting-info">
					<span className="setting-label">{label}</span>
					{desc && <span className="setting-desc">{desc}</span>}
				</div>
				<SettingRowLabelContext.Provider value={label}>{children}</SettingRowLabelContext.Provider>
			</div>
			{divider && <div className="setting-divider" />}
		</>
	);
}
