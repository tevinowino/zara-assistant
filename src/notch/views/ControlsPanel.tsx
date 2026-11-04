import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { VolumeLowIcon } from "../../icons";
import { NotchSlider } from "../components/NotchSlider";
import {
	BatterySaverIcon,
	BellIcon,
	BluetoothIcon,
	BrightnessLowIcon,
	MoonIcon,
	NotchIcon,
	ReloadIcon,
	SettingsIcon,
	TrayIcon,
	WifiIcon
} from "../icons/StatusIcons";
import type { useQuickSettings } from "../hooks/useQuickSettings";
import type { ZaraMode } from "../types";

export interface ControlsPanelProps {
	/** Wi-Fi, Bluetooth, battery-saver and brightness state with their toggles. */
	quick: ReturnType<typeof useQuickSettings>;
	/** The system volume, 0 while muted, and the slider's change handler. */
	displayVolume: number;
	handleVolumeChange: (volume: number) => void;
	/** The notch's mode setting, cycled by the Notch Mode tile. */
	notchMode: string;
	toggleNotchModeSetting: (event: MouseEvent) => Promise<void>;
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
					{/* Pills Grid */}
					<div className="cc-pills-grid">
						{/* Wi-Fi Pill */}
						<div
							className={`cc-pill-tile ${wifiEnabled ? "active" : ""}`}
							onClick={(e) => {
								e.stopPropagation();
								toggleWifi();
							}}
							onContextMenu={handleWifiRightClick}
							title="Left-click to toggle, Right-click for networks"
						>
							<div className="cc-pill-icon-wrapper">
								<WifiIcon enabled={wifiEnabled} connected={wifiConnected} />
							</div>
							<div className="cc-pill-info">
								<span className="cc-pill-title">Wi-Fi</span>
								<span className="cc-pill-status">
									{wifiStatus === null
										? "…"
										: !wifiEnabled
											? "Off"
											: wifiConnected
												? (wifiStatus?.ssid ?? "Connected")
												: "Not connected"}
								</span>
							</div>
							<button
								className="cc-pill-more"
								aria-label="Wi-Fi networks"
								title="Wi-Fi networks"
								onClick={(e) => {
									e.stopPropagation();
									setZaraMode("wifi");
								}}
							>
								<ChevronRight />
							</button>
						</div>

						{/* Bluetooth Pill */}
						<div
							className={`cc-pill-tile ${bluetoothEnabled ? "active" : ""}`}
							onClick={(e) => {
								e.stopPropagation();
								toggleBluetooth();
							}}
							onContextMenu={handleBluetoothRightClick}
							title="Left-click to toggle, Right-click for devices"
						>
							<div className="cc-pill-icon-wrapper">
								<BluetoothIcon />
							</div>
							<div className="cc-pill-info">
								<span className="cc-pill-title">Bluetooth</span>
								<span className="cc-pill-status">
									{!bluetoothEnabled
										? "Off"
										: btConnectedNames.length === 1
											? btConnectedNames[0]
											: btConnectedNames.length > 1
												? `${btConnectedNames.length} connected`
												: "On"}
								</span>
							</div>
							<button
								className="cc-pill-more"
								aria-label="Bluetooth devices"
								title="Bluetooth devices"
								onClick={(e) => {
									e.stopPropagation();
									setZaraMode("bluetooth");
								}}
							>
								<ChevronRight />
							</button>
						</div>

						{/* Notch Mode Pill */}
						<div
							className={`cc-pill-tile ${notchMode === "fixed" ? "active" : ""}`}
							onClick={toggleNotchModeSetting}
							title="Cycle notch mode: Fixed / Smart / Peek"
						>
							<div className="cc-pill-icon-wrapper">
								<NotchIcon />
							</div>
							<div className="cc-pill-info">
								<span className="cc-pill-title">Notch Mode</span>
								<span className="cc-pill-status">
									{notchMode === "fixed" ? "Fixed" : notchMode === "smart" ? "Smart" : "Peek"}
								</span>
							</div>
						</div>
					</div>

					{/* Circular Actions Row */}
					<div className="cc-circular-actions-row">
						<button
							className="cc-circular-btn"
							onClick={(e) => {
								e.stopPropagation();
								invoke("open_app", { appName: "ms-settings:notifications" }).catch(console.error);
							}}
							title="Do Not Disturb — Open Windows notification settings"
						>
							<MoonIcon />
						</button>
						<button
							className={`cc-circular-btn ${batterySaverEnabled ? "active" : ""}`}
							onClick={(e) => {
								e.stopPropagation();
								openBatterySaverSettings();
							}}
							title={`Energy Saver: ${batterySaverEnabled ? "On" : "Off"} — Click to open Settings`}
						>
							<BatterySaverIcon />
						</button>
						<button
							className="cc-circular-btn"
							onClick={(e) => {
								e.stopPropagation();
								openSystemTray(e);
							}}
							title="System Tray"
						>
							<TrayIcon />
						</button>
						<button
							className="cc-circular-btn"
							onClick={(e) => {
								e.stopPropagation();
								invoke("open_notification_center");
							}}
							title="Notification Center"
						>
							<BellIcon />
						</button>
						<button
							className="cc-circular-btn"
							onClick={(e) => {
								e.stopPropagation();
								openSettingsWindow();
							}}
							title="Zara Settings"
						>
							<SettingsIcon />
						</button>
						<button
							className="cc-circular-btn"
							onClick={(e) => {
								e.stopPropagation();
								invoke("restart_zara");
							}}
							title="Restart Zara"
						>
							<ReloadIcon />
						</button>
					</div>

					{/* Classic Sliders Area */}
					<div className="cc-classic-sliders-area">
						{/* Volume Slider */}
						<div className="cc-classic-slider-row">
							<div className="cc-classic-slider-label">
								<VolumeLowIcon style={{ opacity: 0.5 }} />
								<span>Volume</span>
							</div>
							<NotchSlider
								aria-label="Volume"
								min={0}
								max={1}
								step={0.01}
								value={displayVolume}
								onChange={handleVolumeChange}
							/>
							<span className="cc-classic-percentage">{Math.round(displayVolume * 100)}%</span>
						</div>

						{/* Brightness Slider */}
						<div className="cc-classic-slider-row">
							<div className="cc-classic-slider-label">
								<BrightnessLowIcon />
								<span>Brightness</span>
							</div>
							<NotchSlider
								aria-label="Brightness"
								min={0}
								max={100}
								step={1}
								value={currentBrightness}
								onChange={handleBrightnessChange}
							/>
							<span className="cc-classic-percentage">{currentBrightness}%</span>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
