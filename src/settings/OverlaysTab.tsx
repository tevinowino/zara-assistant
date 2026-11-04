import { Volume2, Sun, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

interface OverlaysTabProps {
	volumeOverlayEnabled: boolean;
	toggleVolumeOverlay: () => void;
	volumeEdgeEnabled: boolean;
	toggleVolumeEdge: () => void;
	brightnessOverlayEnabled: boolean;
	toggleBrightnessOverlay: () => void;
	brightnessEdgeEnabled: boolean;
	toggleBrightnessEdge: () => void;
}

export function OverlaysTab({
	volumeOverlayEnabled,
	toggleVolumeOverlay,
	volumeEdgeEnabled,
	toggleVolumeEdge,
	brightnessOverlayEnabled,
	toggleBrightnessOverlay,
	brightnessEdgeEnabled,
	toggleBrightnessEdge
}: OverlaysTabProps) {
	return (
		<>
			<div className="setting-group-label">Overlays</div>
			<div className="setting-group">
				<SettingRow icon={Volume2} label="Volume HUD" desc="Zara volume overlay">
					<SettingSwitch checked={volumeOverlayEnabled} onToggle={toggleVolumeOverlay} />
				</SettingRow>

				{volumeOverlayEnabled && (
					<SettingRow
						icon={ArrowLeftToLine}
						label="Show on Edge Hover"
						desc="Slide in from left edge"
					>
						<SettingSwitch checked={volumeEdgeEnabled} onToggle={toggleVolumeEdge} />
					</SettingRow>
				)}

				<SettingRow icon={Sun} label="Brightness HUD" desc="Zara brightness overlay">
					<SettingSwitch checked={brightnessOverlayEnabled} onToggle={toggleBrightnessOverlay} />
				</SettingRow>

				{brightnessOverlayEnabled && (
					<SettingRow
						icon={ArrowRightToLine}
						label="Show on Edge Hover"
						desc="Slide in from right edge"
						divider={false}
					>
						<SettingSwitch checked={brightnessEdgeEnabled} onToggle={toggleBrightnessEdge} />
					</SettingRow>
				)}
			</div>
		</>
	);
}
