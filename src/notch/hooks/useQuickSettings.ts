import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTrailingThrottle } from "../../hooks/useTrailingThrottle";
import type { WifiStatus, ZaraMode } from "../types";

export interface UseQuickSettingsOptions {
	/** The view the notch is showing; Wi-Fi is polled while the command center is open. */
	zaraMode: ZaraMode;
	/** Receives the system volume read at start-up. */
	setVolume: (volume: number) => void;
	/** Receives the system mute state read at start-up. */
	setIsMuted: (isMuted: boolean) => void;
}

/**
 * The state behind the controls panel tiles: Wi-Fi, Bluetooth, battery saver and
 * screen brightness, kept in step with Windows and with changes made outside Zara.
 */
export function useQuickSettings({ zaraMode, setVolume, setIsMuted }: UseQuickSettingsOptions) {
	// Null until the first successful fetch so the pill can't flash a wrong
	// default on startup.
	const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
	const wifiEnabled = wifiStatus?.enabled ?? false;
	const wifiConnected = wifiStatus?.connected ?? false;
	const [bluetoothEnabled, setBluetoothEnabled] = useState(true);
	// Names of connected Bluetooth devices, for the controls tile.
	const [btConnectedNames, setBtConnectedNames] = useState<string[]>([]);
	const [batterySaverEnabled, setBatterySaverEnabled] = useState(false);
	const [currentBrightness, setCurrentBrightness] = useState(50);

	// Wi-Fi is a three-state control: Off, on-but-not-connected, Connected.
	// The radio state alone can't tell those apart, so get_wifi_status returns
	// both flags, plus the connected network's name. Returns false so the startup loader knows to retry.
	const refreshWifiStatus = useCallback(async (): Promise<boolean> => {
		try {
			setWifiStatus(await invoke<WifiStatus>("get_wifi_status"));
			return true;
		} catch {
			return false;
		}
	}, []);

	// Seed the Wi-Fi pill at startup. The first call can fail while the WLAN
	// service is still coming up, so retry instead of leaving the pill stuck on
	// its default.
	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const initializeWifiStatus = async (attempt: number) => {
			const loaded = await refreshWifiStatus();
			if (!loaded && !cancelled && attempt < 3) {
				retryTimer = setTimeout(() => void initializeWifiStatus(attempt + 1), (attempt + 1) * 1000);
			}
		};
		void initializeWifiStatus(0);
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, [refreshWifiStatus]);

	// Connected Bluetooth devices for the tile, refreshed whenever the backend
	// reports a device connecting, disconnecting, pairing or being removed.
	useEffect(() => {
		if (!bluetoothEnabled) {
			setBtConnectedNames([]);
			return;
		}
		const refresh = () =>
			invoke<{ name: string; connected: boolean }[]>("bluetooth_list_devices")
				.then((devices) =>
					setBtConnectedNames(devices.filter((d) => d.connected).map((d) => d.name))
				)
				.catch(() => {});
		let debounce: ReturnType<typeof setTimeout> | undefined;
		void refresh();
		const unlisten = listen("bluetooth-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refresh(), 400);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [bluetoothEnabled]);

	// The backend reports connection changes and finished scans as they
	// happen, so the pill follows without waiting for the next poll.
	useEffect(() => {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const unlisten = listen("wifi-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refreshWifiStatus(), 300);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [refreshWifiStatus]);

	// Load bluetooth/volume/brightness state on mount
	useEffect(() => {
		invoke<boolean>("get_bluetooth_state")
			.then(setBluetoothEnabled)
			.catch(() => {});
		invoke<boolean>("get_battery_saver_state")
			.then(setBatterySaverEnabled)
			.catch(() => {});
		invoke<{ volume: number; is_muted: boolean }>("get_volume_state")
			.then((state) => {
				setVolume(state.volume);
				setIsMuted(state.is_muted);
			})
			.catch(() => {});
		invoke<number>("get_brightness")
			.then(setCurrentBrightness)
			.catch(() => {});

		// Poll battery saver state every 5s (since we can't listen for changes)
		const interval = setInterval(() => {
			invoke<boolean>("get_battery_saver_state")
				.then(setBatterySaverEnabled)
				.catch(() => {});
		}, 5000);
		return () => clearInterval(interval);
	}, []);

	// Refresh Wi-Fi status while the command center is open so changes made
	// outside Zara (keyboard toggle, Windows quick settings) show up.
	useEffect(() => {
		if (zaraMode !== "command-center") return;
		void refreshWifiStatus();
		const interval = setInterval(() => void refreshWifiStatus(), 5000);
		return () => clearInterval(interval);
	}, [zaraMode, refreshWifiStatus]);

	// Listen for brightness changes
	useEffect(() => {
		const unlisten = listen<{ brightness: number }>("brightness-change", (event) => {
			setCurrentBrightness(event.payload.brightness);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// WiFi toggle
	const toggleWifi = useCallback(async () => {
		const previous = wifiStatus;
		const newState = !(previous?.enabled ?? false);
		setWifiStatus({
			enabled: newState,
			connected: newState ? (previous?.connected ?? false) : false,
			ssid: newState ? (previous?.ssid ?? null) : null
		});
		try {
			await invoke("set_wifi_state", { enabled: newState });
			// The radio and association take a moment to settle.
			setTimeout(() => void refreshWifiStatus(), 800);
		} catch (e) {
			setWifiStatus(previous);
			console.error("Failed to toggle WiFi:", e);
		}
	}, [wifiStatus, refreshWifiStatus]);

	// Bluetooth toggle
	const toggleBluetooth = useCallback(async () => {
		const newState = !bluetoothEnabled;
		setBluetoothEnabled(newState);
		try {
			await invoke("set_bluetooth_state", { enabled: newState });
		} catch (e) {
			setBluetoothEnabled(!newState);
			console.error("Failed to toggle Bluetooth:", e);
		}
	}, [bluetoothEnabled]);

	// Battery Saver - opens settings (no public API to toggle without admin)
	const openBatterySaverSettings = useCallback(async () => {
		try {
			await invoke("open_battery_saver_settings");
		} catch (e) {
			console.error("Failed to open Battery Saver settings:", e);
		}
	}, []);

	// Brightness change with throttling
	const sendBrightness = useTrailingThrottle((newVal: number) => {
		invoke("set_brightness", { brightness: newVal }).catch(() => {});
	}, 50);

	const handleBrightnessChange = useCallback(
		(newVal: number) => {
			setCurrentBrightness(newVal);
			sendBrightness(newVal);
		},
		[sendBrightness]
	);

	return {
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
	};
}
