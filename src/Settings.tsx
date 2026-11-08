import { StrictMode, useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { X } from "./icons/glyphs";
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
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SETTINGS_TABS, settingsTabFor } from "./settings/settingsTabs";
import { useSettingsWidth, useSettingsWindowSize } from "./settings/useSettingsLayout";
import "./fonts.css";
import "./Settings.css";
import "./glisse.css";

const appWindow = getCurrentWebviewWindow();

function SettingsApp() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const [previewFocus, setPreviewFocus] = useState("");
	const contentRef = useRef<HTMLDivElement>(null);
	const settings = useSettings();
	const width = useSettingsWidth(settings.scale);
	useSettingsWindowSize(settings.scale);
	const activeDefinition = settingsTabFor(activeTab);
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
		if (contentRef.current) contentRef.current.scrollTop = 0;
	}, [activeTab]);

	const handleClose = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		await closeSettings();
	};

	return (
		<div
			className="settings-container"
			data-width={width}
			style={{ zoom: settings.scale }}
			inert={isClosing}
		>
			<div className="title-bar" data-tauri-drag-region>
				<span className="title-text" data-tauri-drag-region>
					Settings
				</span>
				<button className="close-btn" onClick={handleClose} title="Close Settings">
					<X size={12} strokeWidth={1.5} className="close-btn-icon" />
				</button>
			</div>

			<div className="settings-body">
				<SettingsSidebar
					tabs={SETTINGS_TABS}
					active={activeTab}
					onSelect={setActiveTab}
					appVersion={settings.appVersion}
				/>

				<div
					className="settings-content"
					data-tone={activeDefinition.tone}
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
					<div className="settings-page">
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
							<h1>{activeDefinition.label}</h1>
							<p>{activeDefinition.description}</p>
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
								notchFollowsCursor={settings.notchFollowsCursor}
								toggleNotchFollowsCursor={settings.toggleNotchFollowsCursor}
								notchEdgeDelay={settings.notchEdgeDelay}
								handleNotchEdgeDelayChange={settings.handleNotchEdgeDelayChange}
								notchPanels={settings.notchPanels}
								setNotchPanelEnabled={settings.setNotchPanelEnabled}
								moveNotchPanel={settings.moveNotchPanel}
								quickApps={settings.quickApps}
								pinQuickApp={settings.pinQuickApp}
								unpinQuickApp={settings.unpinQuickApp}
								moveQuickApp={settings.moveQuickApp}
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
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<SettingsApp />
	</StrictMode>
);
