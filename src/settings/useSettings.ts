import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsSync } from "../hooks/useSettingsSync";
import { reloadIfMirrorWasStale } from "../hooks/settingsMirror";
import { hexToHsl } from "../theme";
import {
	addQuickApp,
	moveQuickApp as moveQuickAppIn,
	parseQuickApps,
	QUICK_APPS_SETTING_KEY,
	removeQuickApp,
	serializeQuickApps,
	type QuickApp
} from "../notch/apps/quickApps";
import {
	asNotchPanel,
	movePanel,
	NOTCH_PANELS_SETTING_KEY,
	parsePanelPreferences,
	readLegacyPanelFlags,
	serializePanelPreferences,
	setPanelEnabled,
	type NotchPanel,
	type NotchPanelPreferences
} from "../notch/panels/notchPanels";
import {
	GLASS_SETTING_KEY,
	parseGlassSettings,
	serializeGlassSettings,
	type GlassSettings
} from "../glassSettings";
import {
	GLOW_SETTING_KEY,
	parseGlowSettings,
	serializeGlowSettings,
	type GlowSettings
} from "../glowSettings";
import { waitForPendingSaves } from "./pendingSaves";
import type { WidgetConfig } from "./types";

function readBool(val: string | null): boolean {
	return val === "true";
}

/** The notch panels a click can open. */
export type NotchPanelChoice = NotchPanel;

// The assistant is the default panel for anyone who has not chosen another.
function asPanelChoice(val: unknown): NotchPanelChoice {
	return asNotchPanel(val) ?? "ai";
}

export function useSettings() {
	const [isLoaded, setIsLoaded] = useState(false);
	const [saveError, setSaveError] = useState(
		() => sessionStorage.getItem("zara-settings-save-error") !== null
	);
	const [saveErrorDetail, setSaveErrorDetail] = useState(
		() => sessionStorage.getItem("zara-settings-save-error-detail") || ""
	);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());
	const saveFailed = useRef(false);
	const flushPendingSaves = useCallback(async () => {
		await waitForPendingSaves(() => saveQueue.current);
		return !saveFailed.current;
	}, []);
	const [autostart, setAutostart] = useState(false);
	const [weatherEnabled, setWeatherEnabled] = useState(true);
	// The apps pinned to the command center, at most four.
	const [quickApps, setQuickApps] = useState<readonly QuickApp[]>(() =>
		parseQuickApps(localStorage.getItem(QUICK_APPS_SETTING_KEY))
	);
	// The widgets the notch shows, in the order it cycles through them.
	const [notchPanels, setNotchPanels] = useState<NotchPanelPreferences>(() =>
		parsePanelPreferences(
			localStorage.getItem(NOTCH_PANELS_SETTING_KEY),
			readLegacyPanelFlags((key) => localStorage.getItem(key))
		)
	);
	const [timerSoundEnabled, setTimerSoundEnabled] = useState(
		() => localStorage.getItem("zara-timer-sound-enabled") !== "false"
	);
	const [musicModeEnabled, setMusicModeEnabled] = useState(true);
	const [notchRememberPanel, setNotchRememberPanel] = useState(
		() =>
			(localStorage.getItem("zara-notch-remember-panel") ??
				localStorage.getItem("zara-notch-click-to-open")) !== "false"
	);
	const [notchDefaultPanel, setNotchDefaultPanel] = useState<NotchPanelChoice>(() =>
		asPanelChoice(localStorage.getItem("zara-notch-default-panel"))
	);
	const [musicCompactNotch, setMusicCompactNotch] = useState(true);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("zara-shelf-persist") === "true"
	);
	const [volumeOverlayEnabled, setVolumeOverlayEnabled] = useState(true);
	const [volumeEdgeEnabled, setVolumeEdgeEnabled] = useState(
		() => localStorage.getItem("zara-volume-edge-enabled") !== "false"
	);
	const [brightnessOverlayEnabled, setBrightnessOverlayEnabled] = useState(
		() => localStorage.getItem("zara-brightness-overlay-enabled") !== "false"
	);
	const [brightnessEdgeEnabled, setBrightnessEdgeEnabled] = useState(
		() => localStorage.getItem("zara-brightness-edge-enabled") !== "false"
	);
	const [mediaAmbienceEnabled, setMediaAmbienceEnabled] = useState(true);
	const [mediaCompactGlowEnabled, setMediaCompactGlowEnabled] = useState(true);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("zara-media-layout") as "classic" | "compact") || "classic"
	);
	const [cornersEnabled, setCornersEnabled] = useState(
		() => localStorage.getItem("zara-corners-enabled") === "true"
	);
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("zara-time-format-24h") === "true"
	);
	const [tempUnitFahrenheit, setTempUnitFahrenheit] = useState(false);
	const [cityName, setCityName] = useState("");
	const [citySearchResults, setCitySearchResults] = useState<
		Array<{ name: string; country: string; latitude: number; longitude: number }>
	>([]);
	const [showCityDropdown, setShowCityDropdown] = useState(false);
	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});
	const [notchMode, setNotchMode] = useState("fixed");
	// On unless turned off; only Smart and Peek can follow, so Fixed ignores it.
	const [notchFollowsCursor, setNotchFollowsCursor] = useState(
		() => localStorage.getItem("zara-notch-follow-cursor") !== "false"
	);
	const [notchEdgeDelay, setNotchEdgeDelay] = useState(() => {
		const val = localStorage.getItem("zara-notch-edge-delay");
		return val !== null ? parseInt(val) : 200;
	});
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(20);
	const [appVersion, setAppVersion] = useState("");
	const [scale, setScale] = useState(() => parseFloat(localStorage.getItem("zara-scale") || "1.0"));
	const [themeMode, setThemeMode] = useState(
		() => localStorage.getItem("zara-theme-mode") || "dark"
	);
	const [themeColor, setThemeColor] = useState(
		() => localStorage.getItem("zara-theme-color") || "#007aff"
	);
	const [themeOpacity, setThemeOpacity] = useState(() => {
		const val = localStorage.getItem("zara-theme-opacity");
		return val !== null ? parseFloat(val) : 0.8;
	});
	const [themeSaturation, setThemeSaturation] = useState(() => {
		const val = localStorage.getItem("zara-theme-saturation");
		return val !== null ? parseFloat(val) : 0.5;
	});
	const [themeBrightness, setThemeBrightness] = useState(() => {
		const val = localStorage.getItem("zara-theme-brightness");
		return val !== null ? parseFloat(val) : 0.15;
	});
	const [glass, setGlass] = useState<GlassSettings>(() =>
		parseGlassSettings(localStorage.getItem(GLASS_SETTING_KEY))
	);
	const [glow, setGlow] = useState<GlowSettings>(() =>
		parseGlowSettings(localStorage.getItem(GLOW_SETTING_KEY))
	);
	const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "success" | "error">(
		"idle"
	);
	const [importStatus, setImportStatus] = useState<"idle" | "importing" | "success" | "error">(
		"idle"
	);

	// ── Load all settings from backend + localStorage ──
	const loadAllSettings = useCallback(async () => {
		try {
			const settings: Record<string, string> = await invoke("load_settings");
			if (await reloadIfMirrorWasStale(settings)) return;
			const getVal = (key: string) => {
				const val = settings[key];
				if (val !== undefined && val !== null) return String(val);
				return localStorage.getItem(key);
			};

			const apply = <T>(
				val: string | null,
				setter: (v: T) => void,
				transform: (v: string) => T
			) => {
				if (val !== null) setter(transform(val));
			};

			apply(getVal("zara-weather-enabled"), setWeatherEnabled, readBool);
			setQuickApps(parseQuickApps(getVal(QUICK_APPS_SETTING_KEY)));
			setNotchPanels(
				parsePanelPreferences(
					getVal(NOTCH_PANELS_SETTING_KEY),
					readLegacyPanelFlags((key) => getVal(key))
				)
			);
			apply(getVal("zara-timer-sound-enabled"), setTimerSoundEnabled, readBool);
			apply(getVal("zara-music-mode-enabled"), setMusicModeEnabled, readBool);
			apply(
				getVal("zara-notch-remember-panel") ?? getVal("zara-notch-click-to-open"),
				setNotchRememberPanel,
				readBool
			);
			apply(getVal("zara-notch-default-panel"), setNotchDefaultPanel, asPanelChoice);
			apply(getVal("zara-music-compact-notch"), setMusicCompactNotch, readBool);
			apply(getVal("zara-shelf-persist"), setShelfPersist, readBool);
			apply(getVal("zara-volume-overlay-enabled"), setVolumeOverlayEnabled, readBool);
			apply(getVal("zara-brightness-overlay-enabled"), setBrightnessOverlayEnabled, readBool);
			apply(getVal("zara-media-ambience-enabled"), setMediaAmbienceEnabled, readBool);
			apply(getVal("zara-media-compact-glow-enabled"), setMediaCompactGlowEnabled, readBool);
			apply(getVal("zara-corners-enabled"), setCornersEnabled, readBool);
			apply(getVal("zara-time-format-24h"), setTimeFormat24h, readBool);
			apply(getVal("zara-volume-edge-enabled"), setVolumeEdgeEnabled, readBool);
			apply(getVal("zara-brightness-edge-enabled"), setBrightnessEdgeEnabled, readBool);

			apply(getVal("zara-temp-unit"), setTempUnitFahrenheit, (v) => v === "fahrenheit");
			apply(getVal("zara-scale"), setScale, parseFloat);
			apply(getVal("zara-low-battery-threshold"), setLowBatteryThreshold, parseInt);

			apply(getVal("zara-notch-mode"), setNotchMode, (v) => (v === "auto-hide" ? "smart" : v));
			apply(getVal("zara-notch-edge-delay"), setNotchEdgeDelay, parseInt);
			apply(getVal("zara-notch-follow-cursor"), setNotchFollowsCursor, (v) => v !== "false");

			const savedCity = getVal("zara-weather-city");
			if (savedCity) setCityName(savedCity);

			apply(getVal("zara-theme-mode"), setThemeMode, (v) => v);
			apply(getVal("zara-theme-color"), setThemeColor, (v) => v);
			apply(getVal("zara-theme-opacity"), setThemeOpacity, parseFloat);
			apply(getVal("zara-theme-saturation"), setThemeSaturation, parseFloat);
			apply(getVal("zara-theme-brightness"), setThemeBrightness, parseFloat);
			apply(getVal(GLASS_SETTING_KEY), setGlass, parseGlassSettings);
			apply(getVal(GLOW_SETTING_KEY), setGlow, parseGlowSettings);

			const widgetsVal = getVal("zara-status-widgets");
			if (widgetsVal) {
				try {
					const parsed = JSON.parse(widgetsVal);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			}
		} catch (e) {
			console.error("Failed to load settings:", e);
		}
		// Also reveal the controls on failure, so a load error cannot trap the
		// user behind the opening indicator. A stale-mirror reload returns above.
		setIsLoaded(true);
	}, []);

	// The file write is authoritative. Serialize controls that change several
	// settings, and update the local mirror only after the backend confirms the
	// write. A failed save reloads the page from persisted values and leaves a
	// visible error instead of keeping an optimistic control value on screen.
	const saveSetting = (key: string, value: string | null): Promise<boolean> => {
		const operation = saveQueue.current.then(async () => {
			if (saveFailed.current) return false;
			try {
				await invoke<void>("save_setting", { key, value });
			} catch (error) {
				console.error(`Failed to save ${key}:`, error);
				saveFailed.current = true;
				sessionStorage.setItem("zara-settings-save-error", "true");
				sessionStorage.setItem("zara-settings-save-error-detail", String(error));
				setSaveErrorDetail(String(error));
				setSaveError(true);
				window.setTimeout(() => window.location.reload(), 0);
				return false;
			}
			try {
				if (value === null) localStorage.removeItem(key);
				else localStorage.setItem(key, value);
				sessionStorage.removeItem("zara-settings-save-error");
				sessionStorage.removeItem("zara-settings-save-error-detail");
			} catch (error) {
				// The file is saved; a mirror failure must not be reported as a failed write.
				console.warn("Settings mirror update failed:", error);
			}
			setSaveError(false);
			return true;
		});
		saveQueue.current = operation.then(() => {});
		return operation;
	};

	// Coordinates only need the backend settings file. Keep them out of the
	// browser's localStorage mirror while preserving the same queued/error path.
	const saveLocation = (
		key: "zara-weather-lat" | "zara-weather-lon",
		value: string | null
	): Promise<boolean> => {
		const operation = saveQueue.current.then(async () => {
			if (saveFailed.current) return false;
			try {
				await invoke<void>("save_setting", { key, value });
			} catch (error) {
				console.error(`Failed to save ${key}:`, error);
				saveFailed.current = true;
				sessionStorage.setItem("zara-settings-save-error", "true");
				sessionStorage.setItem("zara-settings-save-error-detail", String(error));
				setSaveErrorDetail(String(error));
				setSaveError(true);
				window.setTimeout(() => window.location.reload(), 0);
				return false;
			}
			try {
				localStorage.removeItem(key);
				sessionStorage.removeItem("zara-settings-save-error");
				sessionStorage.removeItem("zara-settings-save-error-detail");
			} catch (error) {
				console.warn("Settings mirror cleanup failed:", error);
			}
			setSaveError(false);
			return true;
		});
		saveQueue.current = operation.then(() => {});
		return operation;
	};

	const dismissSaveError = () => {
		sessionStorage.removeItem("zara-settings-save-error");
		sessionStorage.removeItem("zara-settings-save-error-detail");
		setSaveErrorDetail("");
		setSaveError(false);
	};

	// ── Initialize on mount ──
	useEffect(() => {
		loadAllSettings();

		isEnabled()
			.then(setAutostart)
			.catch(() => {});

		getVersion()
			.then((ver) => setAppVersion(ver || "3.1.2"))
			.catch(() => setAppVersion("3.1.2"));
	}, []);

	// ── Sync settings from other windows ──
	useSettingsSync({
		"zara-notch-mode": setNotchMode,
		"zara-notch-edge-delay": setNotchEdgeDelay,
		"zara-notch-follow-cursor": setNotchFollowsCursor,
		"zara-weather-enabled": setWeatherEnabled,
		[NOTCH_PANELS_SETTING_KEY]: (value: unknown) => setNotchPanels(parsePanelPreferences(value)),
		[QUICK_APPS_SETTING_KEY]: (value: unknown) => setQuickApps(parseQuickApps(value)),
		"zara-timer-sound-enabled": setTimerSoundEnabled,
		"zara-music-mode-enabled": setMusicModeEnabled,
		"zara-notch-remember-panel": setNotchRememberPanel,
		"zara-notch-default-panel": (v: unknown) => setNotchDefaultPanel(asPanelChoice(v)),
		"zara-music-compact-notch": setMusicCompactNotch,
		"zara-media-ambience-enabled": setMediaAmbienceEnabled,
		"zara-media-compact-glow-enabled": setMediaCompactGlowEnabled,
		"zara-media-layout": setMediaLayout,
		"zara-corners-enabled": setCornersEnabled,
		"zara-time-format-24h": setTimeFormat24h,
		"zara-low-battery-threshold": setLowBatteryThreshold,
		"zara-scale": setScale,
		"zara-temp-unit": (v) => setTempUnitFahrenheit(v === "fahrenheit"),
		"zara-volume-overlay-enabled": setVolumeOverlayEnabled,
		"zara-volume-edge-enabled": setVolumeEdgeEnabled,
		"zara-brightness-overlay-enabled": setBrightnessOverlayEnabled,
		"zara-brightness-edge-enabled": setBrightnessEdgeEnabled,
		"zara-theme-mode": setThemeMode,
		"zara-theme-color": setThemeColor,
		"zara-theme-opacity": setThemeOpacity,
		"zara-theme-saturation": setThemeSaturation,
		"zara-theme-brightness": setThemeBrightness,
		[GLASS_SETTING_KEY]: (v: unknown) => setGlass(parseGlassSettings(v)),
		[GLOW_SETTING_KEY]: (v: unknown) => setGlow(parseGlowSettings(v)),
		"zara-weather-city": (v) => setCityName(v || "")
	});

	// ── Listen for system accent changes (adaptive theme) ──
	useEffect(() => {
		const unlisten = listen<string>("system-accent-changed", (event) => {
			const mode = localStorage.getItem("zara-theme-mode") || "dark";
			if (mode === "adaptive") {
				try {
					const hsl = hexToHsl(event.payload);
					setThemeSaturation(hsl.s / 100);
					setThemeBrightness(hsl.l / 100);
				} catch (e) {
					console.error("Failed to parse system accent color change HSL:", e);
				}
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// ── City search debounce ──
	useEffect(() => {
		if (cityName.trim().length < 2) {
			setCitySearchResults([]);
			setShowCityDropdown(false);
			return;
		}

		const timeout = setTimeout(async () => {
			try {
				const res = await fetch(
					`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=en&format=json`
				);
				const data = await res.json();
				if (data.results && data.results.length > 0) {
					setCitySearchResults(
						data.results.map((r: any) => ({
							name: r.name,
							country: r.country || "",
							latitude: r.latitude,
							longitude: r.longitude
						}))
					);
					setShowCityDropdown(true);
				} else {
					setCitySearchResults([]);
				}
			} catch {
				setCitySearchResults([]);
			}
		}, 300);

		return () => clearTimeout(timeout);
	}, [cityName]);

	// ── Autostart ──
	const toggleAutostart = async () => {
		try {
			const currentlyEnabled = await isEnabled();
			if (currentlyEnabled) {
				await disable();
				setAutostart(false);
			} else {
				await enable();
				setAutostart(true);
			}
		} catch (err) {}
	};

	// ── Simple boolean toggles ──
	const toggleWeather = () => {
		const next = !weatherEnabled;
		setWeatherEnabled(next);
		saveSetting("zara-weather-enabled", String(next));
	};

	const saveQuickApps = (next: readonly QuickApp[]) => {
		if (next === quickApps) return;
		setQuickApps(next);
		saveSetting(QUICK_APPS_SETTING_KEY, serializeQuickApps(next));
	};

	/** Pins an app to the command center. Nothing happens if it is pinned or four are. */
	const pinQuickApp = (app: QuickApp) => saveQuickApps(addQuickApp(quickApps, app));
	const unpinQuickApp = (target: string) => saveQuickApps(removeQuickApp(quickApps, target));
	const moveQuickApp = (target: string, direction: -1 | 1) =>
		saveQuickApps(moveQuickAppIn(quickApps, target, direction));

	const saveNotchPanels = (next: NotchPanelPreferences) => {
		if (next === notchPanels) return;
		setNotchPanels(next);
		saveSetting(NOTCH_PANELS_SETTING_KEY, serializePanelPreferences(next));
	};

	/** Turns a widget on or off. The last one on stays on, so the notch always has something to open. */
	const setNotchPanelEnabled = (panel: NotchPanel, enabled: boolean) =>
		saveNotchPanels(setPanelEnabled(notchPanels, panel, enabled));

	/** Moves a widget one place earlier (-1) or later (1) in the order the notch cycles through them. */
	const moveNotchPanel = (panel: NotchPanel, direction: -1 | 1) =>
		saveNotchPanels(movePanel(notchPanels, panel, direction));

	const toggleTimerSound = () => {
		const next = !timerSoundEnabled;
		setTimerSoundEnabled(next);
		saveSetting("zara-timer-sound-enabled", String(next));
	};

	const toggleMusicMode = () => {
		const next = !musicModeEnabled;
		setMusicModeEnabled(next);
		saveSetting("zara-music-mode-enabled", String(next));
	};

	const toggleNotchRememberPanel = () => {
		const next = !notchRememberPanel;
		setNotchRememberPanel(next);
		saveSetting("zara-notch-remember-panel", String(next));
	};

	const changeNotchDefaultPanel = (panel: NotchPanelChoice) => {
		setNotchDefaultPanel(panel);
		saveSetting("zara-notch-default-panel", panel);
	};

	const toggleMusicCompactNotch = () => {
		const next = !musicCompactNotch;
		setMusicCompactNotch(next);
		saveSetting("zara-music-compact-notch", String(next));
	};

	const toggleShelfPersist = () => {
		const next = !shelfPersist;
		setShelfPersist(next);
		saveSetting("zara-shelf-persist", String(next));
	};

	const toggleMediaLayout = (layout: "classic" | "compact") => {
		setMediaLayout(layout);
		saveSetting("zara-media-layout", layout);
	};

	const toggleVolumeOverlay = () => {
		const next = !volumeOverlayEnabled;
		setVolumeOverlayEnabled(next);
		saveSetting("zara-volume-overlay-enabled", String(next));
	};

	const toggleVolumeEdge = () => {
		const next = !volumeEdgeEnabled;
		setVolumeEdgeEnabled(next);
		saveSetting("zara-volume-edge-enabled", String(next));
	};

	const toggleBrightnessOverlay = () => {
		const next = !brightnessOverlayEnabled;
		setBrightnessOverlayEnabled(next);
		saveSetting("zara-brightness-overlay-enabled", String(next));
	};

	const toggleBrightnessEdge = () => {
		const next = !brightnessEdgeEnabled;
		setBrightnessEdgeEnabled(next);
		saveSetting("zara-brightness-edge-enabled", String(next));
	};

	const toggleAmbience = () => {
		const next = !mediaAmbienceEnabled;
		setMediaAmbienceEnabled(next);
		saveSetting("zara-media-ambience-enabled", String(next));
	};

	const toggleCompactGlow = () => {
		const next = !mediaCompactGlowEnabled;
		setMediaCompactGlowEnabled(next);
		saveSetting("zara-media-compact-glow-enabled", String(next));
	};

	const toggleCorners = () => {
		const next = !cornersEnabled;
		setCornersEnabled(next);
		saveSetting("zara-corners-enabled", String(next));
	};

	const toggleTimeFormat24h = () => {
		const next = !timeFormat24h;
		setTimeFormat24h(next);
		saveSetting("zara-time-format-24h", String(next));
	};

	const toggleTempUnit = () => {
		const next = !tempUnitFahrenheit;
		setTempUnitFahrenheit(next);
		saveSetting("zara-temp-unit", next ? "fahrenheit" : "celsius");
	};

	// ── Value setters ──
	const toggleNotchFollowsCursor = () => {
		const next = !notchFollowsCursor;
		setNotchFollowsCursor(next);
		saveSetting("zara-notch-follow-cursor", String(next));
	};

	const setNotchModeValue = (newMode: string) => {
		setNotchMode(newMode);
		saveSetting("zara-notch-mode", newMode);
	};

	const handleNotchEdgeDelayChange = (val: number) => {
		setNotchEdgeDelay(val);
		saveSetting("zara-notch-edge-delay", val.toString());
	};

	const handleThresholdChange = (val: number) => {
		setLowBatteryThreshold(val);
		saveSetting("zara-low-battery-threshold", val.toString());
	};

	const handleScaleChange = (val: number) => {
		setScale(val);
		saveSetting("zara-scale", val.toString());
	};

	const handleWidgetsChange = (config: WidgetConfig) => {
		setStatusWidgets(config);
		saveSetting("zara-status-widgets", JSON.stringify(config));
	};

	// ── Theme handlers ──
	const handleThemeModeChange = async (mode: string) => {
		setThemeMode(mode);
		saveSetting("zara-theme-mode", mode);

		if (mode === "adaptive") {
			try {
				const accentHex = await invoke<string>("get_system_accent_color");
				const hsl = hexToHsl(accentHex);
				setThemeSaturation(hsl.s / 100);
				saveSetting("zara-theme-saturation", String(hsl.s / 100));
				setThemeBrightness(hsl.l / 100);
				saveSetting("zara-theme-brightness", String(hsl.l / 100));
			} catch (e) {
				console.error("Failed to parse adaptive accent HSL:", e);
			}
		}
	};

	const handleThemeColorChange = (color: string) => {
		setThemeColor(color);
		saveSetting("zara-theme-color", color);

		try {
			const hsl = hexToHsl(color);
			setThemeSaturation(hsl.s / 100);
			saveSetting("zara-theme-saturation", String(hsl.s / 100));
			setThemeBrightness(hsl.l / 100);
			saveSetting("zara-theme-brightness", String(hsl.l / 100));
		} catch (e) {
			console.error("Failed to parse custom color HSL:", e);
		}
	};

	const handleOpacityChange = (value: number) => {
		setThemeOpacity(value);
		saveSetting("zara-theme-opacity", String(value));
	};

	const handleSaturationChange = (value: number) => {
		setThemeSaturation(value);
		saveSetting("zara-theme-saturation", String(value));
	};

	const handleBrightnessChange = (value: number) => {
		setThemeBrightness(value);
		saveSetting("zara-theme-brightness", String(value));
	};

	/** Changes some of the glow options, keeping the rest as they are. */
	const handleGlowChange = (change: Partial<GlowSettings>) => {
		const next = parseGlowSettings({ ...glow, ...change });
		setGlow(next);
		saveSetting(GLOW_SETTING_KEY, serializeGlowSettings(next));
	};

	/** Changes some of the glass options, keeping the rest as they are. */
	const handleGlassChange = (change: Partial<GlassSettings>) => {
		const next = parseGlassSettings({ ...glass, ...change });
		setGlass(next);
		saveSetting(GLASS_SETTING_KEY, serializeGlassSettings(next));
	};

	// ── City search ──
	const selectCity = async (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => {
		setCityName(city.name);
		setShowCityDropdown(false);
		setCitySearchResults([]);
		const saved =
			(await saveLocation("zara-weather-lat", city.latitude.toString())) &&
			(await saveLocation("zara-weather-lon", city.longitude.toString())) &&
			(await saveSetting("zara-weather-city", city.name));
		if (saved) emit("weather-refresh", { lat: city.latitude, lon: city.longitude });
	};

	const handleCityClear = async () => {
		setCityName("");
		setShowCityDropdown(false);
		setCitySearchResults([]);
		const saved =
			(await saveLocation("zara-weather-lat", null)) &&
			(await saveLocation("zara-weather-lon", null)) &&
			(await saveSetting("zara-weather-city", null));
		if (saved) emit("weather-refresh", true);
	};

	// ── Reset to defaults ──
	const resetToDefaults = async () => {
		try {
			const { ask } = await import("@tauri-apps/plugin-dialog");
			const confirmed = await ask("All settings return to their defaults and Zara restarts.", {
				title: "Reset Zara to Defaults",
				kind: "warning",
				okLabel: "Reset and Restart",
				cancelLabel: "Cancel"
			});
			if (!confirmed) return;

			await invoke("reset_settings");

			// settings.json is cleared, but every window also caches zara keys
			// in localStorage; drop them so the restart can't resurrect values.
			// The first-run/version sentinels are lifecycle markers, not
			// preferences — keeping them avoids replaying the splash, which
			// would also re-trigger the first-run autostart enable.
			const keep = new Set(["zara-first-run", "zara-app-version"]);
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith("zara-") && !keep.has(key)) localStorage.removeItem(key);
			}

			await invoke("restart_zara").catch(console.error);
		} catch (e) {
			console.error("Reset failed:", e);
		}
	};

	// ── Export / Import ──
	// The backend opens the native dialog and owns the file path, so these
	// cannot be used to read or write arbitrary files from a webview.
	const handleExportSettings = async () => {
		setExportStatus("exporting");
		try {
			const filePath = await invoke<string | null>("export_settings_to_file");
			if (filePath) {
				setExportStatus("success");
				setTimeout(() => setExportStatus("idle"), 2000);
			} else {
				setExportStatus("idle");
			}
		} catch (e) {
			console.error("Export failed:", e);
			setExportStatus("error");
			setTimeout(() => setExportStatus("idle"), 3000);
		}
	};

	const handleImportSettings = async () => {
		setImportStatus("importing");
		try {
			const filePath = await invoke<string | null>("import_settings_from_file");
			if (filePath) {
				await loadAllSettings();
				setImportStatus("success");
				setTimeout(() => setImportStatus("idle"), 2000);
			} else {
				setImportStatus("idle");
			}
		} catch (e) {
			console.error("Import failed:", e);
			setImportStatus("error");
			setTimeout(() => setImportStatus("idle"), 3000);
		}
	};

	return {
		isLoaded,
		flushPendingSaves,
		saveError,
		saveErrorDetail,
		dismissSaveError,
		// System
		autostart,
		toggleAutostart,
		lowBatteryThreshold,
		handleThresholdChange,
		timeFormat24h,
		toggleTimeFormat24h,
		scale,
		handleScaleChange,
		cornersEnabled,
		toggleCorners,

		// Theme
		themeMode,
		handleThemeModeChange,
		themeColor,
		handleThemeColorChange,
		themeOpacity,
		handleOpacityChange,
		themeSaturation,
		handleSaturationChange,
		themeBrightness,
		handleBrightnessChange,
		glass,
		handleGlassChange,
		glow,
		handleGlowChange,

		// Notch
		notchMode,
		setNotchModeValue,
		notchFollowsCursor,
		toggleNotchFollowsCursor,
		notchEdgeDelay,
		handleNotchEdgeDelayChange,
		notchPanels,
		setNotchPanelEnabled,
		moveNotchPanel,
		quickApps,
		pinQuickApp,
		unpinQuickApp,
		moveQuickApp,
		timerSoundEnabled,
		toggleTimerSound,
		musicModeEnabled,
		toggleMusicMode,
		notchRememberPanel,
		toggleNotchRememberPanel,
		notchDefaultPanel,
		changeNotchDefaultPanel,
		musicCompactNotch,
		toggleMusicCompactNotch,
		shelfPersist,
		toggleShelfPersist,
		mediaLayout,
		toggleMediaLayout,
		mediaAmbienceEnabled,
		toggleAmbience,
		mediaCompactGlowEnabled,
		toggleCompactGlow,

		// Weather
		weatherEnabled,
		toggleWeather,
		tempUnitFahrenheit,
		toggleTempUnit,
		cityName,
		setCityName,
		citySearchResults,
		showCityDropdown,
		setShowCityDropdown,
		selectCity,
		handleCityClear,

		// Widgets
		statusWidgets,
		handleWidgetsChange,

		// Overlays
		volumeOverlayEnabled,
		toggleVolumeOverlay,
		volumeEdgeEnabled,
		toggleVolumeEdge,
		brightnessOverlayEnabled,
		toggleBrightnessOverlay,
		brightnessEdgeEnabled,
		toggleBrightnessEdge,

		// About
		appVersion,

		// Import / Export
		exportStatus,
		importStatus,
		handleExportSettings,
		handleImportSettings,

		// Utilities
		restartZara: () => invoke("restart_zara"),
		resetToDefaults,
		quitZara: () => invoke("quit_zara")
	};
}
