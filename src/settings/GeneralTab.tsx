import { Power, Clock, BatteryWarning, RefreshCw, RotateCcw, LogOut } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { SettingSlider } from "./SettingSlider";
import { SettingSwitch } from "./SettingSwitch";

interface GeneralTabProps {
	autostart: boolean;
	toggleAutostart: () => void;
	timeFormat24h: boolean;
	toggleTimeFormat24h: () => void;
	lowBatteryThreshold: number;
	handleThresholdChange: (val: number) => void;
	restartZara: () => void;
	resetToDefaults: () => void;
	quitZara: () => void;
}

export function GeneralTab({
	autostart,
	toggleAutostart,
	timeFormat24h,
	toggleTimeFormat24h,
	lowBatteryThreshold,
	handleThresholdChange,
	restartZara,
	resetToDefaults,
	quitZara
}: GeneralTabProps) {
	return (
		<>
			<div className="setting-group-label">System</div>
			<div className="setting-group">
				<SettingRow icon={Power} label="Launch at Login" desc="Open Zara automatically">
					<SettingSwitch checked={autostart} onToggle={toggleAutostart} />
				</SettingRow>

				<SettingRow icon={Clock} label="24-Hour Time" desc="Use 24-hour clock format">
					<SettingSwitch checked={timeFormat24h} onToggle={toggleTimeFormat24h} />
				</SettingRow>

				<SettingRow
					icon={BatteryWarning}
					label="Low Battery Alert"
					desc={`Trigger at ${lowBatteryThreshold}%`}
					divider={false}
				>
					<SettingSlider
						min={5}
						max={50}
						step={5}
						value={lowBatteryThreshold}
						onChange={handleThresholdChange}
					/>
				</SettingRow>
			</div>

			<div className="setting-group-label">App</div>
			<div className="setting-group">
				<SettingRow
					icon={RotateCcw}
					label="Reset to Defaults"
					desc="Restore all settings and restart Zara"
					action
					danger
					onClick={resetToDefaults}
				/>
				<SettingRow
					icon={RefreshCw}
					label="Restart Zara"
					desc="Reinitialize all components"
					action
					onClick={restartZara}
				/>
				<SettingRow
					icon={LogOut}
					label="Quit Zara"
					desc="Exit application completely"
					action
					danger
					onClick={quitZara}
					divider={false}
				/>
			</div>
		</>
	);
}
