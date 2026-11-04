import { StrictMode, useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { X, Settings, Palette, PanelTop, Layers, Info, Sparkles, BookOpen } from "lucide-react";
import {
	useSettings,
	GeneralTab,
	AppearanceTab,
	NotchTab,
	AssistantTab,
	LibraryTab,
	OverlaysTab,
	AboutTab
} from "./settings/index";
import type { SettingsTab } from "./settings/index";
import { initTheme } from "./theme";
import { FeaturePreview } from "./settings/FeaturePreview";
import "./Settings.css";
import "./glisse.css";

const appWindow = getCurrentWebviewWindow();

const TABS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "notch", label: "Notch", icon: PanelTop },
	{ id: "assistant", label: "Assistant", icon: Sparkles },
	{ id: "library", label: "Library", icon: BookOpen },
	{ id: "overlays", label: "Overlays", icon: Layers },
	{ id: "about", label: "About", icon: Info }
];

const TAB_COPY: Record<SettingsTab, string> = {
	general: "The essentials for how Zara starts and runs.",
	appearance: "Make every surface feel at home on your desktop.",
	notch: "Choose what appears at the top of your screen.",
	assistant: "Which AI service and model Zara uses, and what Zara can be seen by.",
	library: "Your notes, what Zara remembers, and saved conversations.",
	overlays: "Keep quick controls visible only when you need them.",
	about: "Version, credits and your settings data."
};

function SettingsApp() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const [previewFocus, setPreviewFocus] = useState("");
	const contentRef = useRef<HTMLDivElement>(null);
	const settings = useSettings();
	useEffect(() => {
		if (!settings.isLoaded) return;
		document.documentElement.dataset.settingsReady = "true";
		document.getElementById("settings-loading")?.setAttribute("aria-hidden", "true");
		document.getElementById("root")?.setAttribute("aria-busy", "false");
	}, [settings.isLoaded]);
	const closingRef = useRef(false);
	const [isClosing, setIsClosing] = useState(false);
	const { flushPendingSaves } = settings;
	const closeSettings = useCallback(async () => {
		if (closingRef.current) return;
		closingRef.current = true;
		setIsClosing(true);
		try {
			if (await flushPendingSaves()) await invoke("close_settings_window");
		} catch (error) {
			console.error("Failed to close Settings:", error);
		} finally {
			closingRef.current = false;
			setIsClosing(false);
		}
	}, [flushPendingSaves]);

	useEffect(() => {
		const unlisten = appWindow.onCloseRequested((event) => {
			event.preventDefault();
			return closeSettings();
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, [closeSettings]);

	useEffect(() => {
		return initTheme();
	}, []);

	useEffect(() => {
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext as any);

		appWindow
			.setEffects({
				effects: ["mica" as Effect],
				state: "active" as any
			})
			.catch(() => {});

		return () => {
			document.removeEventListener("contextmenu", preventContext as any);
		};
	}, []);

	useEffect(() => {
		invoke("resize_settings_window", {
			width: 740 * settings.scale,
			height: 560 * settings.scale
		}).catch(console.error);
	}, [settings.scale]);

	useEffect(() => {
		if (contentRef.current) contentRef.current.scrollTop = 0;
	}, [activeTab]);

	const handleClose = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		await closeSettings();
	};

	return (
		<div className="settings-container" style={{ zoom: settings.scale }} inert={isClosing}>
			<div className="title-bar" data-tauri-drag-region>
				<span className="title-text" data-tauri-drag-region>
					Settings
				</span>
				<button className="close-btn" onClick={handleClose} title="Close Settings">
					<X size={12} strokeWidth={1.5} className="close-btn-icon" />
				</button>
			</div>

			<div className="settings-body">
				<div className="settings-sidebar">
					<div className="settings-sidebar-intro">
						<strong>Zara</strong>
						<span>Make it yours</span>
					</div>
					{TABS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							className={`sidebar-tab ${activeTab === id ? "active" : ""}`}
							onClick={() => setActiveTab(id)}
						>
							<div className="sidebar-tab-icon">
								<Icon size={14} strokeWidth={1.5} />
							</div>
							<span>{label}</span>
						</button>
					))}
				</div>

				<div
					className="settings-content"
					ref={contentRef}
					onChangeCapture={(event) => {
						const target = event.target as HTMLElement;
						const row = target.closest(".setting-item");
						let label = row?.querySelector(".setting-label")?.textContent;
						if (!label && target.closest(".settings-disclosure-standalone"))
							label = "Status Widgets";
						if (activeTab === "overlays" && label === "Show on Edge Hover") {
							const edgeRows = Array.from(
								contentRef.current?.querySelectorAll(".setting-item") ?? []
							).filter((item) => item.querySelector(".setting-label")?.textContent === label);
							label =
								row === edgeRows[edgeRows.length - 1] && edgeRows.length > 1
									? "Brightness Edge Hover"
									: "Volume Edge Hover";
						}
						if (label) setPreviewFocus(activeTab + ":" + label + ":" + Date.now());
					}}
					onClickCapture={(event) => {
						const label = (event.target as HTMLElement)
							.closest(".setting-item")
							?.querySelector(".setting-label")?.textContent;
						if (label === "Weather Status") {
							setPreviewFocus(activeTab + ":" + label + ":" + Date.now());
						}
					}}
				>
					{settings.saveError && (
						<div className="settings-save-error" role="alert">
							<span>
								Changes could not be saved. Your saved settings have been restored.
								{settings.saveErrorDetail && (
									<small style={{ display: "block" }}>{settings.saveErrorDetail}</small>
								)}
							</span>
							<button onClick={settings.dismissSaveError} aria-label="Dismiss save error">
								<X size={14} strokeWidth={2} />
							</button>
						</div>
					)}
					<div className="settings-page-heading">
						<h1>{TABS.find((tab) => tab.id === activeTab)?.label}</h1>
						<p>{TAB_COPY[activeTab]}</p>
					</div>
					<FeaturePreview tab={activeTab} settings={settings} focus={previewFocus} />
					{activeTab === "general" && (
						<GeneralTab
							autostart={settings.autostart}
							toggleAutostart={settings.toggleAutostart}
							timeFormat24h={settings.timeFormat24h}
							toggleTimeFormat24h={settings.toggleTimeFormat24h}
							lowBatteryThreshold={settings.lowBatteryThreshold}
							handleThresholdChange={settings.handleThresholdChange}
							restartZara={settings.restartZara}
							resetToDefaults={settings.resetToDefaults}
							quitZara={settings.quitZara}
						/>
					)}
					{activeTab === "appearance" && (
						<AppearanceTab
							themeMode={settings.themeMode}
							handleThemeModeChange={settings.handleThemeModeChange}
							themeColor={settings.themeColor}
							handleThemeColorChange={settings.handleThemeColorChange}
							themeOpacity={settings.themeOpacity}
							handleOpacityChange={settings.handleOpacityChange}
							themeSaturation={settings.themeSaturation}
							handleSaturationChange={settings.handleSaturationChange}
							themeBrightness={settings.themeBrightness}
							handleBrightnessChange={settings.handleBrightnessChange}
							glass={settings.glass}
							handleGlassChange={settings.handleGlassChange}
							glow={settings.glow}
							handleGlowChange={settings.handleGlowChange}
							cornersEnabled={settings.cornersEnabled}
							toggleCorners={settings.toggleCorners}
							scale={settings.scale}
							handleScaleChange={settings.handleScaleChange}
						/>
					)}
					{activeTab === "notch" && (
						<NotchTab
							notchMode={settings.notchMode}
							setNotchModeValue={settings.setNotchModeValue}
							notchEdgeDelay={settings.notchEdgeDelay}
							handleNotchEdgeDelayChange={settings.handleNotchEdgeDelayChange}
							calendarEnabled={settings.calendarEnabled}
							toggleCalendar={settings.toggleCalendar}
							controlsPanelEnabled={settings.controlsPanelEnabled}
							toggleControlsPanel={settings.toggleControlsPanel}
							devicesPanelEnabled={settings.devicesPanelEnabled}
							toggleDevicesPanel={settings.toggleDevicesPanel}
							aiPanelEnabled={settings.aiPanelEnabled}
							toggleAiPanel={settings.toggleAiPanel}
							enabledPanelCount={settings.enabledPanelCount}
							notchRememberPanel={settings.notchRememberPanel}
							toggleNotchRememberPanel={settings.toggleNotchRememberPanel}
							notchDefaultPanel={settings.notchDefaultPanel}
							changeNotchDefaultPanel={settings.changeNotchDefaultPanel}
							timerSoundEnabled={settings.timerSoundEnabled}
							toggleTimerSound={settings.toggleTimerSound}
							musicModeEnabled={settings.musicModeEnabled}
							toggleMusicMode={settings.toggleMusicMode}
							musicCompactNotch={settings.musicCompactNotch}
							toggleMusicCompactNotch={settings.toggleMusicCompactNotch}
							shelfPersist={settings.shelfPersist}
							toggleShelfPersist={settings.toggleShelfPersist}
							mediaLayout={settings.mediaLayout}
							toggleMediaLayout={settings.toggleMediaLayout}
							mediaAmbienceEnabled={settings.mediaAmbienceEnabled}
							toggleAmbience={settings.toggleAmbience}
							mediaCompactGlowEnabled={settings.mediaCompactGlowEnabled}
							toggleCompactGlow={settings.toggleCompactGlow}
							weatherEnabled={settings.weatherEnabled}
							toggleWeather={settings.toggleWeather}
							tempUnitFahrenheit={settings.tempUnitFahrenheit}
							toggleTempUnit={settings.toggleTempUnit}
							cityName={settings.cityName}
							setCityName={settings.setCityName}
							citySearchResults={settings.citySearchResults}
							showCityDropdown={settings.showCityDropdown}
							setShowCityDropdown={settings.setShowCityDropdown}
							selectCity={settings.selectCity}
							handleCityClear={settings.handleCityClear}
							statusWidgets={settings.statusWidgets}
							handleWidgetsChange={settings.handleWidgetsChange}
						/>
					)}
					{activeTab === "assistant" && <AssistantTab />}
					{activeTab === "library" && <LibraryTab />}
					{activeTab === "overlays" && (
						<OverlaysTab
							volumeOverlayEnabled={settings.volumeOverlayEnabled}
							toggleVolumeOverlay={settings.toggleVolumeOverlay}
							volumeEdgeEnabled={settings.volumeEdgeEnabled}
							toggleVolumeEdge={settings.toggleVolumeEdge}
							brightnessOverlayEnabled={settings.brightnessOverlayEnabled}
							toggleBrightnessOverlay={settings.toggleBrightnessOverlay}
							brightnessEdgeEnabled={settings.brightnessEdgeEnabled}
							toggleBrightnessEdge={settings.toggleBrightnessEdge}
						/>
					)}
					{activeTab === "about" && (
						<AboutTab
							appVersion={settings.appVersion}
							exportStatus={settings.exportStatus}
							importStatus={settings.importStatus}
							handleExportSettings={settings.handleExportSettings}
							handleImportSettings={settings.handleImportSettings}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<SettingsApp />
	</StrictMode>
);
