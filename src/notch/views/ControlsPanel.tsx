import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { AppIcon } from "../apps/AppIcon";
import type { QuickApp } from "../apps/quickApps";
import { CommandTile } from "../components/CommandTile";
import { LevelSlider } from "../components/LevelSlider";
import {
	BellRing,
	Bluetooth,
	Moon,
	PanelTop,
	RotateCw,
	Settings,
	Sun,
	Volume2,
	Wifi,
	Zap,
	AppWindow
} from "../../icons/glyphs";
import type { useQuickSettings } from "../hooks/useQuickSettings";
import type { ZaraMode } from "../types";

/**
 * Height of the notch while it shows the command center with no apps pinned, including its
 * 36px top row: 14px above, the 184px tile grid, a 14px gap, the 40px round buttons and 18px below.
 */
export const COMMAND_CENTER_PANEL_HEIGHT_PX = 306;
/** What the row of pinned apps adds: its 54px tiles and the 14px gap above them. */
export const COMMAND_CENTER_APPS_ROW_PX = 68;
/**
 * The width of the notch while it shows the command center. Inside its 18px padding, the two
 * 46px sliders and their gaps leave 244px for the four tiles, 117px each.
 */
export const COMMAND_CENTER_PANEL_WIDTH_PX = 392;

/** The height of the notch while it shows the command center with `appCount` apps pinned. */
export function commandCenterPanelHeight(appCount: number): number {
	return COMMAND_CENTER_PANEL_HEIGHT_PX + (appCount > 0 ? COMMAND_CENTER_APPS_ROW_PX : 0);
}

export interface ControlsPanelProps {
	/** Wi-Fi, Bluetooth, battery-saver and brightness state with their toggles. */
	quick: ReturnType<typeof useQuickSettings>;
	/** The system volume, 0 while muted, and the slider's change handler. */
	displayVolume: number;
	handleVolumeChange: (volume: number) => void;
	/** The notch's mode setting, cycled by the Notch Mode tile. */
	notchMode: string;
	toggleNotchModeSetting: (event: MouseEvent) => Promise<void>;
	/** The apps the user pinned, at most four, and how one is opened. */
	quickApps: readonly QuickApp[];
	openQuickApp: (app: QuickApp) => void;
	/** Round action buttons. */
	openSystemTray: (event: MouseEvent) => Promise<void>;
	openSettingsWindow: () => Promise<void>;
	/** Right-click opens the tile's own view, the same as its arrow. */
	handleWifiRightClick: (event: MouseEvent) => void;
	handleBluetoothRightClick: (event: MouseEvent) => void;
	/** The view the notch is showing; the panel is only drawn while this is "command-center". */
	zaraMode: ZaraMode;
	setZaraMode: Dispatch<SetStateAction<ZaraMode>>;
}

/** The controls panel: Wi-Fi, Bluetooth, notch mode and battery-saver tiles, quick actions, and the volume and brightness sliders. */
export function ControlsPanel({
	quick,
	displayVolume,
	handleVolumeChange,
	notchMode,
	toggleNotchModeSetting,
	quickApps,
	openQuickApp,
	openSystemTray,
	openSettingsWindow,
	handleWifiRightClick,
	handleBluetoothRightClick,
	zaraMode,
	setZaraMode
}: ControlsPanelProps) {
	const {
		wifiStatus,
		wifiEnabled,
		wifiConnected,
		bluetoothEnabled,
		btConnectedNames,
		batterySaverEnabled,
		currentBrightness,
		toggleWifi,
		toggleBluetooth,
		openBatterySaverSettings,
		handleBrightnessChange
	} = quick;
	const notchModeLabel = notchMode === "fixed" ? "Fixed" : notchMode === "smart" ? "Smart" : "Peek";
	const bluetoothStatus = !bluetoothEnabled
		? "Off"
		: btConnectedNames.length === 1
			? btConnectedNames[0]
			: btConnectedNames.length > 1
				? `${btConnectedNames.length} connected`
				: "On";
	const wifiLabel =
		wifiStatus === null
			? "…"
			: !wifiEnabled
				? "Off"
				: wifiConnected
					? (wifiStatus?.ssid ?? "Connected")
					: "Not connected";

	return (
		<AnimatePresence>
			{zaraMode === "command-center" && (
				<motion.div
					className="command-center-content-minimal"
					onClick={(e) => e.stopPropagation()}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
				>
					<div className="cc-grid">
						<div className="cc-tiles">
							<CommandTile
								icon={<Wifi size={18} style={{ opacity: !wifiEnabled ? 0.4 : wifiConnected ? 1 : 0.7 }} />}
								title="Wi-Fi"
								status={wifiLabel}
								pressed={wifiEnabled}
								onPress={() => toggleWifi()}
								onSecondaryPress={handleWifiRightClick}
								more={{ label: "Wi-Fi networks", onPress: () => setZaraMode("wifi") }}
								hint="Click to toggle, right-click for networks"
							/>
							<CommandTile
								icon={<Bluetooth size={18} />}
								title="Bluetooth"
								status={bluetoothStatus}
								pressed={bluetoothEnabled}
								onPress={() => toggleBluetooth()}
								onSecondaryPress={handleBluetoothRightClick}
								more={{ label: "Bluetooth devices", onPress: () => setZaraMode("bluetooth") }}
								hint="Click to toggle, right-click for devices"
							/>
							<CommandTile
								icon={<PanelTop size={18} />}
								title="Notch"
								status={notchModeLabel}
								lit={notchMode === "fixed"}
								onPress={toggleNotchModeSetting}
								hint="Cycle notch mode: Fixed, Smart, Peek"
							/>
							<CommandTile
								icon={<Zap size={18} />}
								title="Energy"
								label={`Energy Saver, ${batterySaverEnabled ? "On" : "Off"}`}
								status={batterySaverEnabled ? "Saver On" : "Saver Off"}
								tone="green"
								lit={batterySaverEnabled}
								onPress={() => openBatterySaverSettings()}
								hint="Open Windows Energy Saver settings"
							/>
						</div>

						<LevelSlider
							aria-label="Volume"
							min={0}
							max={1}
							step={0.01}
							value={displayVolume}
							onChange={handleVolumeChange}
							icon={<Volume2 size={18} />}
						/>
						<LevelSlider
							aria-label="Brightness"
							min={0}
							max={100}
							step={1}
							value={currentBrightness}
							onChange={handleBrightnessChange}
							icon={<Sun size={18} />}
						/>
					</div>

					{quickApps.length > 0 && (
						<div className="cc-apps" role="group" aria-label="Your apps">
							{quickApps.map((app) => (
								<button
									key={app.target}
									type="button"
									className="cc-app"
									aria-label={`Open ${app.name}`}
									title={app.name}
									onClick={(e) => {
										e.stopPropagation();
										openQuickApp(app);
									}}
								>
									<AppIcon app={app} size={32} />
								</button>
							))}
						</div>
					)}

					<div className="cc-actions">
						<button
							type="button"
							className="cc-action"
							aria-label="Do Not Disturb"
							title="Do Not Disturb: open Windows notification settings"
							onClick={(e) => {
								e.stopPropagation();
								invoke("open_app", { appName: "ms-settings:notifications" }).catch(console.error);
							}}
						>
							<Moon size={20} />
						</button>
						<button
							type="button"
							className="cc-action"
							aria-label="System tray"
							title="System tray"
							onClick={(e) => {
								e.stopPropagation();
								openSystemTray(e);
							}}
						>
							<AppWindow size={20} />
						</button>
						<button
							type="button"
							className="cc-action"
							aria-label="Notification center"
							title="Notification center"
							onClick={(e) => {
								e.stopPropagation();
								invoke("open_notification_center");
							}}
						>
							<BellRing size={20} />
						</button>
						<button
							type="button"
							className="cc-action"
							aria-label="Zara settings"
							title="Zara settings"
							onClick={(e) => {
								e.stopPropagation();
								openSettingsWindow();
							}}
						>
							<Settings size={20} />
						</button>
						<button
							type="button"
							className="cc-action"
							aria-label="Restart Zara"
							title="Restart Zara"
							onClick={(e) => {
								e.stopPropagation();
								invoke("restart_zara");
							}}
						>
							<RotateCw size={20} />
						</button>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
