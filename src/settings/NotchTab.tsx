import { PanelTop, MonitorSmartphone, BellRing, Music, Minimize2, LayoutList, Sparkles, Circle, CloudSun, Timer, Archive, X } from "../icons/glyphs";
import { SegmentedControl } from "glisse";
import { SettingRow } from "./SettingRow";
import { SettingSlider } from "./SettingSlider";
import { SettingSwitch } from "./SettingSwitch";
import { StatusWidgetConfig } from "../components/StatusWidgetConfig";
import type { WidgetConfig } from "./types";
import type { NotchPanelChoice } from "./useSettings";
import { WidgetPicker } from "./WidgetPicker";
import { QuickAppsSection } from "./QuickAppsSection";
import { NotificationsSection } from "./NotificationsSection";
import type { QuickApp } from "../notch/apps/quickApps";
import type { MediaLayout } from "../notch/music/mediaLayouts";
import {
	isPanelEnabled,
	notchPanelDefinition,
	type NotchPanel,
	type NotchPanelPreferences
} from "../notch/panels/notchPanels";

interface NotchTabProps {
	notchMode: string;
	setNotchModeValue: (mode: string) => void;
	notchFollowsCursor: boolean;
	toggleNotchFollowsCursor: () => void;
	notchEdgeDelay: number;
	handleNotchEdgeDelayChange: (val: number) => void;
	notchPanels: NotchPanelPreferences;
	setNotchPanelEnabled: (panel: NotchPanel, enabled: boolean) => void;
	moveNotchPanel: (panel: NotchPanel, direction: -1 | 1) => void;
	quickApps: readonly QuickApp[];
	pinQuickApp: (app: QuickApp) => void;
	unpinQuickApp: (target: string) => void;
	moveQuickApp: (target: string, direction: -1 | 1) => void;
	notchRememberPanel: boolean;
	toggleNotchRememberPanel: () => void;
	notchDefaultPanel: NotchPanelChoice;
	changeNotchDefaultPanel: (panel: NotchPanelChoice) => void;
	timerSoundEnabled: boolean;
	toggleTimerSound: () => void;
	musicModeEnabled: boolean;
	toggleMusicMode: () => void;
	musicCompactNotch: boolean;
	toggleMusicCompactNotch: () => void;
	shelfPersist: boolean;
	toggleShelfPersist: () => void;
	mediaLayout: MediaLayout;
	toggleMediaLayout: (layout: MediaLayout) => void;
	mediaAmbienceEnabled: boolean;
	toggleAmbience: () => void;
	mediaCompactGlowEnabled: boolean;
	toggleCompactGlow: () => void;
	weatherEnabled: boolean;
	toggleWeather: () => void;
	tempUnitFahrenheit: boolean;
	toggleTempUnit: () => void;
	cityName: string;
	setCityName: (name: string) => void;
	citySearchResults: Array<{ name: string; country: string; latitude: number; longitude: number }>;
	showCityDropdown: boolean;
	setShowCityDropdown: (show: boolean) => void;
	selectCity: (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => void;
	handleCityClear: () => void;
	statusWidgets: WidgetConfig;
	handleWidgetsChange: (config: WidgetConfig) => void;
}

export function NotchTab({
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
	notchRememberPanel,
	toggleNotchRememberPanel,
	notchDefaultPanel,
	changeNotchDefaultPanel,
	timerSoundEnabled,
	toggleTimerSound,
	musicModeEnabled,
	toggleMusicMode,
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
	statusWidgets,
	handleWidgetsChange
}: NotchTabProps) {
	const calendarEnabled = isPanelEnabled(notchPanels, "calendar");
	// The default can only be a widget that is on; if it was turned off, the first one on.
	const defaultChoice = isPanelEnabled(notchPanels, notchDefaultPanel)
		? notchDefaultPanel
		: notchPanels.enabled[0];

	return (
		<>
			<div className="setting-group-label">Notch</div>
			<div className="setting-group">
				<SettingRow icon={PanelTop} label="Notch Behavior" desc="Choose how the notch appears">
					<select
						className="settings-select"
						value={notchMode}
						onChange={(e) => setNotchModeValue(e.target.value)}
					>
						<option value="fixed">Fixed</option>
						<option value="smart">Smart</option>
						<option value="peek">Peek</option>
					</select>
				</SettingRow>

				{notchMode !== "fixed" && (
					<SettingRow
						icon={MonitorSmartphone}
						label="Follow Cursor"
						desc="With more than one screen, move the notch to the screen the cursor rests at the top of"
					>
						<SettingSwitch checked={notchFollowsCursor} onToggle={toggleNotchFollowsCursor} />
					</SettingRow>
				)}

				{notchMode !== "fixed" && (
					<SettingRow
						icon={Timer}
						label="Peek Delay"
						desc={
							notchEdgeDelay === 0
								? "Reveal instantly on top-edge contact"
								: `Rest on the top edge for ${notchEdgeDelay}ms to reveal`
						}
					>
						<SettingSlider
							min={0}
							max={800}
							step={50}
							value={notchEdgeDelay}
							onChange={handleNotchEdgeDelayChange}
						/>
					</SettingRow>
				)}
			</div>

			<div className="setting-group-label">Widgets</div>
			<WidgetPicker
				preferences={notchPanels}
				onToggle={setNotchPanelEnabled}
				onMove={moveNotchPanel}
			/>

			<div className="setting-group-label">Command Center apps</div>
			<QuickAppsSection
				apps={quickApps}
				onAdd={pinQuickApp}
				onRemove={unpinQuickApp}
				onMove={moveQuickApp}
			/>
			{!isPanelEnabled(notchPanels, "command-center") && (
				<p className="settings-note">
					These appear in the Command Center widget, which is turned off above.
				</p>
			)}

			<div className="setting-group-label">Opening</div>
			<div className="setting-group">
				{calendarEnabled && (
					<SettingRow
						icon={BellRing}
						label="Timer Sound"
						desc="Play a chime when the timer finishes"
					>
						<SettingSwitch checked={timerSoundEnabled} onToggle={toggleTimerSound} />
					</SettingRow>
				)}

				<SettingRow
					icon={PanelTop}
					label="Remember Last Widget"
					desc="Reopen the widget you last used; turn off to choose a fixed default"
				>
					<SettingSwitch checked={notchRememberPanel} onToggle={toggleNotchRememberPanel} />
				</SettingRow>

				{!notchRememberPanel && (
					<SettingRow
						icon={PanelTop}
						label="Default Widget"
						desc="Open this widget when you click the notch"
						divider={false}
					>
						<select
							className="settings-select"
							value={defaultChoice}
							onChange={(e) => changeNotchDefaultPanel(e.target.value as NotchPanelChoice)}
						>
							{notchPanels.enabled.map((panel) => (
								<option key={panel} value={panel}>
									{notchPanelDefinition(panel).label}
								</option>
							))}
						</select>
					</SettingRow>
				)}
			</div>

			<div className="setting-group-label">Notifications</div>
			<NotificationsSection />

			<div className="setting-group-label">Music</div>
			<div className="setting-group">
				<SettingRow icon={Music} label="Music Mode" desc="Interactive live music widget">
					<SettingSwitch checked={musicModeEnabled} onToggle={toggleMusicMode} />
				</SettingRow>

				{musicModeEnabled && (
					<details className="settings-disclosure">
						<summary>
							Music options <span>Layout and visual effects</span>
						</summary>
						<SettingRow
							icon={Minimize2}
							label="Compact Mode"
							desc="Show visualizer & artwork when collapsed"
						>
							<SettingSwitch checked={musicCompactNotch} onToggle={toggleMusicCompactNotch} />
						</SettingRow>

						<SettingRow icon={LayoutList} label="Media Layout" desc="Choose expanded player style">
							<SegmentedControl
								aria-label="Media Layout"
								items={[
									{ value: "classic", label: "Classic" },
									{ value: "compact", label: "Compact" },
									{ value: "card", label: "Card" }
								]}
								value={mediaLayout}
								onValueChange={(layout) => toggleMediaLayout(layout as MediaLayout)}
							/>
						</SettingRow>

						<SettingRow
							icon={Sparkles}
							label="Ambient Glow"
							desc="Colored glow behind expanded album art"
						>
							<SettingSwitch checked={mediaAmbienceEnabled} onToggle={toggleAmbience} />
						</SettingRow>

						<SettingRow
							icon={Circle}
							label="Compact Glow"
							desc="Glow around collapsed thumbnail"
							divider={false}
						>
							<SettingSwitch checked={mediaCompactGlowEnabled} onToggle={toggleCompactGlow} />
						</SettingRow>
					</details>
				)}
			</div>

			<div className="setting-group-label">Shelf</div>
			<div className="setting-group">
				<SettingRow
					icon={Archive}
					label="Keep Items"
					desc="Keep shelf items after Zara closes"
					divider={false}
				>
					<SettingSwitch checked={shelfPersist} onToggle={toggleShelfPersist} />
				</SettingRow>
			</div>

			<div className="setting-group-label">Weather</div>
			<div className="setting-group">
				<SettingRow
					icon={CloudSun}
					label="Weather Status"
					desc={cityName || "Auto-detect location"}
				>
					<div className="weather-controls">
						<SegmentedControl
							aria-label="Temperature unit"
							items={[
								{ value: "C", label: "°C" },
								{ value: "F", label: "°F" }
							]}
							value={tempUnitFahrenheit ? "F" : "C"}
							onValueChange={(unit) => {
								if ((unit === "F") !== tempUnitFahrenheit) toggleTempUnit();
							}}
						/>
						<SettingSwitch checked={weatherEnabled} onToggle={toggleWeather} />
					</div>
				</SettingRow>

				{weatherEnabled && (
					<div className="manual-city-input">
						<div className="city-input-row">
							<input
								type="text"
								placeholder="Search city..."
								value={cityName}
								onChange={(e) => setCityName(e.target.value)}
								onFocus={() => citySearchResults.length > 0 && setShowCityDropdown(true)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && citySearchResults.length > 0) {
										e.preventDefault();
										selectCity(citySearchResults[0]);
									}
									if (e.key === "Escape") {
										setShowCityDropdown(false);
									}
								}}
								onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
							/>
							{cityName && (
								<button
									className="city-clear-btn"
									onMouseDown={(e) => {
										e.preventDefault();
										handleCityClear();
									}}
									title="Clear city"
								>
									<X size={10} strokeWidth={2.5} />
								</button>
							)}
						</div>
						{showCityDropdown && citySearchResults.length > 0 && (
							<div className="city-dropdown">
								{citySearchResults.map((city) => (
									<button
										key={`${city.name}-${city.latitude}`}
										className="city-dropdown-item"
										onMouseDown={(e) => {
											e.preventDefault();
											selectCity(city);
										}}
									>
										<span className="city-dropdown-name">{city.name}</span>
										<span className="city-dropdown-country">{city.country}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="setting-group-label">Widgets</div>
			<div className="setting-group">
				<details className="settings-disclosure settings-disclosure-standalone">
					<summary>
						Choose status widgets <span>Arrange what appears beside the clock</span>
					</summary>
					<StatusWidgetConfig value={statusWidgets} onChange={handleWidgetsChange} />
				</details>
			</div>
		</>
	);
}
