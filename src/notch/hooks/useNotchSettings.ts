import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import type { WidgetConfig } from "../../components/StatusWidgetConfig";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import { reloadIfMirrorWasStale } from "../../hooks/settingsMirror";
import { asNotchPanel, type NotchPanel } from "../types";

export interface UseNotchSettingsOptions {
	/** The window this notch runs in ("main" for the notch itself); empty until known. */
	windowLabel: string;
}

/**
 * Every persisted setting the notch reads, plus the start-up read of settings.json.
 * Values start from the browser's copy so the first paint is right, are replaced by
 * the saved file once it loads, and follow changes made in the Settings window.
 */
export function useNotchSettings({ windowLabel }: UseNotchSettingsOptions) {
	const [scale, setScale] = useState(() => parseFloat(localStorage.getItem("zara-scale") || "1.0"));
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("zara-time-format-24h") === "true"
	);

	const [notchMode, setNotchMode] = useState(() => {
		const raw = localStorage.getItem("zara-notch-mode") || "fixed";
		if (raw === "auto-hide") return "smart";
		return raw;
	});
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(() =>
		parseInt(localStorage.getItem("zara-low-battery-threshold") || "20")
	);

	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});

	const [systemSettingsReady, setSystemSettingsReady] = useState(false);
	const [waitForStartupSplash, setWaitForStartupSplash] = useState(false);

	// Settings state
	const [settingsWeatherEnabled, setSettingsWeatherEnabled] = useState(
		() => localStorage.getItem("zara-weather-enabled") !== "false"
	);
	const [settingsCalendarEnabled, setSettingsCalendarEnabled] = useState(
		() => localStorage.getItem("zara-calendar-enabled") !== "false"
	);
	// Which panels the notch shows. Calendar and Controls are on by default;
	// Connected devices (and panels added later) are opt-in.
	const [settingsControlsPanelEnabled, setSettingsControlsPanelEnabled] = useState(
		() => localStorage.getItem("zara-notch-command-center-enabled") !== "false"
	);
	const [settingsAiPanelEnabled, setSettingsAiPanelEnabled] = useState(
		() => localStorage.getItem("zara-notch-ai-enabled") !== "false"
	);

	const [settingsDevicesPanelEnabled, setSettingsDevicesPanelEnabled] = useState(
		() => localStorage.getItem("zara-notch-devices-enabled") === "true"
	);

	const [settingsTimerSoundEnabled, setSettingsTimerSoundEnabled] = useState(
		() => localStorage.getItem("zara-timer-sound-enabled") !== "false"
	);
	const [settingsMusicModeEnabled, setSettingsMusicModeEnabled] = useState(
		() => localStorage.getItem("zara-music-mode-enabled") !== "false"
	);
	const [rememberPanelEnabled, setRememberPanelEnabled] = useState(
		() =>
			(localStorage.getItem("zara-notch-remember-panel") ??
				localStorage.getItem("zara-notch-click-to-open")) !== "false"
	);
	const rememberPanelEnabledRef = useRef(rememberPanelEnabled);
	rememberPanelEnabledRef.current = rememberPanelEnabled;
	const [defaultPanel, setDefaultPanel] = useState<NotchPanel>(
		() => asNotchPanel(localStorage.getItem("zara-notch-default-panel")) ?? "ai"
	);
	// The panel the open notch was last left on. Opening the notch returns to it,
	// across restarts too (zara-notch-last-panel).
	const [lastPanel, setLastPanel] = useState<NotchPanel | null>(() =>
		asNotchPanel(localStorage.getItem("zara-notch-last-panel"))
	);
	const [settingsMusicCompactNotch, setSettingsMusicCompactNotch] = useState(
		() => localStorage.getItem("zara-music-compact-notch") !== "false"
	);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("zara-shelf-persist") === "true"
	);
	const [settingsVisualizerEnabled, setSettingsVisualizerEnabled] = useState(
		() => localStorage.getItem("zara-visualizer-enabled") !== "false"
	);
	const [settingsAlbumArtEnabled, setSettingsAlbumArtEnabled] = useState(
		() => localStorage.getItem("zara-media-album-art-enabled") !== "false"
	);
	const [settingsAmbienceEnabled, setSettingsAmbienceEnabled] = useState(
		() => localStorage.getItem("zara-media-ambience-enabled") !== "false"
	);
	const [settingsCompactGlowEnabled, setSettingsCompactGlowEnabled] = useState(
		() => localStorage.getItem("zara-media-compact-glow-enabled") !== "false"
	);
	const [settingsCornersEnabled, setSettingsCornersEnabled] = useState(
		() => localStorage.getItem("zara-corners-enabled") === "true"
	);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("zara-media-layout") as "classic" | "compact") || "classic"
	);

	useEffect(() => {
		if (!windowLabel) return;
		let cancelled = false;

		invoke("load_settings")
			.then(async (settings: any) => {
				if (await reloadIfMirrorWasStale(settings)) return;
				if (cancelled) return;
				const getVal = (key: string, fallback: string | null = null) => {
					const val = settings[key];
					if (val !== undefined && val !== null) return String(val);
					const local = localStorage.getItem(key);
					if (local !== null) return local;
					return fallback;
				};

				setSettingsWeatherEnabled(getVal("zara-weather-enabled", "true") !== "false");
				setSettingsCalendarEnabled(getVal("zara-calendar-enabled", "true") !== "false");
				setSettingsControlsPanelEnabled(
					getVal("zara-notch-command-center-enabled", "true") !== "false"
				);
				setSettingsDevicesPanelEnabled(getVal("zara-notch-devices-enabled", "false") === "true");
				setSettingsAiPanelEnabled(getVal("zara-notch-ai-enabled", "true") !== "false");
				setSettingsTimerSoundEnabled(getVal("zara-timer-sound-enabled", "true") !== "false");
				setSettingsMusicModeEnabled(getVal("zara-music-mode-enabled", "true") !== "false");
				setRememberPanelEnabled(
					(getVal("zara-notch-remember-panel") ?? getVal("zara-notch-click-to-open", "true")) !==
						"false"
				);
				setDefaultPanel(asNotchPanel(getVal("zara-notch-default-panel")) ?? "ai");
				setShelfPersist(getVal("zara-shelf-persist", "false") === "true");
				setSettingsMusicCompactNotch(getVal("zara-music-compact-notch", "true") !== "false");
				setLastPanel(asNotchPanel(getVal("zara-notch-last-panel")));
				const viz =
					getVal("zara-media-visualizer-enabled") ?? getVal("zara-visualizer-enabled", "true");
				setSettingsVisualizerEnabled(viz !== "false");
				setSettingsAlbumArtEnabled(getVal("zara-media-album-art-enabled", "true") !== "false");
				setSettingsAmbienceEnabled(getVal("zara-media-ambience-enabled", "true") !== "false");
				setSettingsCompactGlowEnabled(
					getVal("zara-media-compact-glow-enabled", "true") !== "false"
				);
				setSettingsCornersEnabled(getVal("zara-corners-enabled", "false") === "true");
				setTimeFormat24h(getVal("zara-time-format-24h") === "true");

				const thresholdStr = getVal("zara-low-battery-threshold", "20");
				if (thresholdStr) setLowBatteryThreshold(parseInt(thresholdStr as string));

				const nMode = getVal("zara-notch-mode", "fixed");
				if (nMode) {
					const mapped = nMode === "auto-hide" ? "smart" : nMode;
					setNotchMode(mapped);
				}

				if (windowLabel === "main") {
					const firstRun = localStorage.getItem("zara-first-run") === null;
					if (firstRun) {
						import("@tauri-apps/plugin-autostart").then(({ enable, isEnabled }) => {
							isEnabled().then((enabled) => {
								if (!enabled) enable().catch(() => {});
							});
						});
						localStorage.setItem("zara-first-run", "done");
					}
					const storedVersion = localStorage.getItem("zara-app-version");
					let waitForSplash = firstRun || storedVersion === null;
					if (!waitForSplash) {
						try {
							waitForSplash = storedVersion !== (await getVersion());
						} catch {
							// Version lookup is optional; continue startup without a splash.
						}
					}
					if (cancelled) return;
					setWaitForStartupSplash(waitForSplash);
					setSystemSettingsReady(true);
				}

				const scaleVal = getVal("zara-scale");
				if (scaleVal !== null) setScale(parseFloat(scaleVal));

				const widgetsVal = getVal("zara-status-widgets");
				if (widgetsVal) {
					try {
						const parsed = JSON.parse(widgetsVal);
						if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
							setStatusWidgets(parsed);
						}
					} catch {}
				}
			})
			.catch((error) => {
				console.error(error);
				if (!cancelled && windowLabel === "main") setSystemSettingsReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [windowLabel]); // eslint-disable-line react-hooks/exhaustive-deps

	// Settings sync — consolidated dispatch for all settings events
	useSettingsSync(
		{
			"zara-weather-enabled": setSettingsWeatherEnabled,
			"zara-calendar-enabled": setSettingsCalendarEnabled,
			"zara-notch-command-center-enabled": setSettingsControlsPanelEnabled,
			"zara-notch-devices-enabled": setSettingsDevicesPanelEnabled,
			"zara-notch-ai-enabled": setSettingsAiPanelEnabled,
			"zara-timer-sound-enabled": setSettingsTimerSoundEnabled,
			"zara-music-mode-enabled": setSettingsMusicModeEnabled,
			"zara-notch-remember-panel": setRememberPanelEnabled,
			"zara-notch-default-panel": (v: unknown) => setDefaultPanel(asNotchPanel(v) ?? "ai"),
			"zara-shelf-persist": setShelfPersist,
			"zara-music-compact-notch": setSettingsMusicCompactNotch,
			"zara-notch-last-panel": (v: unknown) => setLastPanel(asNotchPanel(v)),
			"zara-media-visualizer-enabled": setSettingsVisualizerEnabled,
			"zara-visualizer-enabled": setSettingsVisualizerEnabled,
			"zara-media-album-art-enabled": setSettingsAlbumArtEnabled,
			"zara-media-ambience-enabled": setSettingsAmbienceEnabled,
			"zara-media-compact-glow-enabled": setSettingsCompactGlowEnabled,
			"zara-media-layout": setMediaLayout,
			"zara-corners-enabled": setSettingsCornersEnabled,
			"zara-scale": setScale,
			"zara-low-battery-threshold": setLowBatteryThreshold,
			"zara-notch-mode": setNotchMode,
			"zara-status-widgets": (value) => {
				try {
					const parsed = JSON.parse(value);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			},
			"zara-time-format-24h": setTimeFormat24h
		},
		[windowLabel]
	);

	return {
		scale,
		timeFormat24h,
		notchMode,
		setNotchMode,
		statusWidgets,
		systemSettingsReady,
		waitForStartupSplash,
		settingsWeatherEnabled,
		settingsCalendarEnabled,
		settingsControlsPanelEnabled,
		settingsAiPanelEnabled,
		settingsDevicesPanelEnabled,
		settingsTimerSoundEnabled,
		settingsMusicModeEnabled,
		rememberPanelEnabled,
		rememberPanelEnabledRef,
		defaultPanel,
		lastPanel,
		setLastPanel,
		settingsMusicCompactNotch,
		shelfPersist,
		settingsVisualizerEnabled,
		settingsAlbumArtEnabled,
		settingsAmbienceEnabled,
		settingsCompactGlowEnabled,
		settingsCornersEnabled,
		mediaLayout,
		setMediaLayout,
		lowBatteryThreshold
	};
}
