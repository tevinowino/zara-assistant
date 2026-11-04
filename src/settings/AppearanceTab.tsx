import { Palette, Droplet, Contrast, Droplets, Sun, Square, Maximize2, Gem, Lightbulb, Blend, Ruler, Snowflake, Rainbow, Layers, Sparkles, type Glyph } from "../icons/glyphs";
import { SettingRow } from "./SettingRow";
import { SettingSlider } from "./SettingSlider";
import { SettingSwitch } from "./SettingSwitch";
import { MAX_EDGE_WIDTH_PX, MIN_EDGE_WIDTH_PX, type GlassSettings } from "../glassSettings";
import type { GlowSettings } from "../glowSettings";

type GlassSliderKey = Exclude<keyof GlassSettings, "enabled">;

interface GlassSliderSpec {
	key: GlassSliderKey;
	icon: Glyph;
	label: string;
	/** Says what the slider does, and shows its current value. */
	describe: (value: number) => string;
	min: number;
	max: number;
	step: number;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Every glass slider, in the order they are shown. */
const GLASS_SLIDERS: GlassSliderSpec[] = [
	{
		key: "edgeShine",
		icon: Lightbulb,
		label: "Edge Shine",
		describe: (v) => `How brightly the rim catches the light (${percent(v)})`,
		min: 0,
		max: 1,
		step: 0.05
	},
	{
		key: "edgeWidthPx",
		icon: Ruler,
		label: "Edge Thickness",
		describe: (v) => `Width of the rim (${v}px)`,
		min: MIN_EDGE_WIDTH_PX,
		max: MAX_EDGE_WIDTH_PX,
		step: 0.5
	},
	{
		key: "dispersion",
		icon: Rainbow,
		label: "Dispersion",
		describe: (v) => `Cool and warm colour fringe along the rim (${percent(v)})`,
		min: 0,
		max: 1,
		step: 0.05
	},
	{
		key: "sheen",
		icon: Blend,
		label: "Surface Sheen",
		describe: (v) => `Light washing down from the top (${percent(v)})`,
		min: 0,
		max: 1,
		step: 0.05
	},
	{
		key: "frost",
		icon: Snowflake,
		label: "Frost",
		describe: (v) => `Milky haze through the glass (${percent(v)})`,
		min: 0,
		max: 1,
		step: 0.05
	},
	{
		key: "depth",
		icon: Layers,
		label: "Depth",
		describe: (v) => `Shading toward the edges that gives thickness (${percent(v)})`,
		min: 0,
		max: 1,
		step: 0.05
	}
];
interface AppearanceTabProps {
	themeMode: string;
	handleThemeModeChange: (mode: string) => void;
	themeColor: string;
	handleThemeColorChange: (color: string) => void;
	themeOpacity: number;
	handleOpacityChange: (val: number) => void;
	themeSaturation: number;
	handleSaturationChange: (val: number) => void;
	themeBrightness: number;
	handleBrightnessChange: (val: number) => void;
	glass: GlassSettings;
	handleGlassChange: (change: Partial<GlassSettings>) => void;
	glow: GlowSettings;
	handleGlowChange: (change: Partial<GlowSettings>) => void;
	cornersEnabled: boolean;
	toggleCorners: () => void;
	scale: number;
	handleScaleChange: (val: number) => void;
}

export function AppearanceTab({
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
	cornersEnabled,
	toggleCorners,
	scale,
	handleScaleChange
}: AppearanceTabProps) {
	const showCustomColor = themeMode === "custom";
	const showAdvancedSliders = themeMode === "custom" || themeMode === "adaptive";

	return (
		<>
			<div className="setting-group-label">Theme</div>
			<div className="setting-group">
				<SettingRow icon={Palette} label="Theme Mode" desc="Configure visual styling">
					<select
						className="settings-select"
						value={themeMode}
						onChange={(e) => handleThemeModeChange(e.target.value)}
					>
						<option value="dark">Dark (Translucent)</option>
						<option value="light">Light (Translucent)</option>
						<option value="custom">Custom Color</option>
						<option value="adaptive">Adaptive Accent</option>
					</select>
				</SettingRow>

				{showCustomColor && (
					<SettingRow
						icon={Droplet}
						label="Custom Theme Color"
						desc="Choose layout background color"
					>
						<div className="color-picker-row">
							<input
								type="color"
								value={themeColor}
								onChange={(e) => handleThemeColorChange(e.target.value)}
								className="color-picker-input"
							/>
							<span className="color-picker-label">{themeColor.toUpperCase()}</span>
						</div>
					</SettingRow>
				)}

				<SettingRow
					icon={Contrast}
					label="Background Opacity"
					desc={`Adjust theme transparency (${Math.round(themeOpacity * 100)}%)`}
					divider={showAdvancedSliders}
				>
					<SettingSlider
						min={0.1}
						max={1}
						step={0.05}
						value={themeOpacity}
						onChange={handleOpacityChange}
					/>
				</SettingRow>

				{showAdvancedSliders && (
					<>
						<SettingRow
							icon={Droplets}
							label="Color Saturation"
							desc={`Adjust theme color vibrancy (${Math.round(themeSaturation * 100)}%)`}
						>
							<SettingSlider
								min={0}
								max={1}
								step={0.02}
								value={themeSaturation}
								onChange={handleSaturationChange}
							/>
						</SettingRow>

						<SettingRow
							icon={Sun}
							label="Background Brightness"
							desc={`Adjust background lightness (${Math.round(themeBrightness * 100)}%)`}
							divider={false}
						>
							<SettingSlider
								min={0}
								max={1}
								step={0.02}
								value={themeBrightness}
								onChange={handleBrightnessChange}
							/>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label">Glass</div>
			<div className="setting-group">
				<SettingRow
					icon={Gem}
					label="Liquid Glass"
					desc="A lit rim and sheen on the notch and edge overlays. Lower Background Opacity to make it clearer."
					divider={glass.enabled}
				>
					<SettingSwitch
						checked={glass.enabled}
						onToggle={() => handleGlassChange({ enabled: !glass.enabled })}
					/>
				</SettingRow>

				{glass.enabled &&
					GLASS_SLIDERS.map(({ key, icon, label, describe, min, max, step }, index) => (
						<SettingRow
							key={key}
							icon={icon}
							label={label}
							desc={describe(glass[key])}
							divider={index < GLASS_SLIDERS.length - 1}
						>
							<SettingSlider
								min={min}
								max={max}
								step={step}
								value={glass[key]}
								onChange={(value) => handleGlassChange({ [key]: value })}
							/>
						</SettingRow>
					))}
			</div>

			<div className="setting-group-label">Glow</div>
			<div className="setting-group">
				<SettingRow
					icon={Sparkles}
					label="Accent Glow"
					desc="A soft halo of colour around the notch and edge overlays"
					divider={glow.enabled}
				>
					<SettingSwitch
						checked={glow.enabled}
						onToggle={() => handleGlowChange({ enabled: !glow.enabled })}
					/>
				</SettingRow>

				{glow.enabled && (
					<>
						<SettingRow
							icon={Lightbulb}
							label="Glow Intensity"
							desc={`How visible the halo is (${percent(glow.intensity)})`}
						>
							<SettingSlider
								min={0}
								max={1}
								step={0.05}
								value={glow.intensity}
								onChange={(intensity) => handleGlowChange({ intensity })}
							/>
						</SettingRow>

						<SettingRow
							icon={Droplet}
							label="Glow Color"
							desc={glow.color === null ? "Following the theme accent" : "A colour you chose"}
							divider={false}
						>
							<div className="color-picker-row">
								{glow.color !== null && (
									<button
										type="button"
										className="settings-button quiet"
										onClick={() => handleGlowChange({ color: null })}
									>
										Use theme
									</button>
								)}
								<input
									type="color"
									aria-label="Glow Color"
									value={glow.color ?? themeColor}
									onChange={(e) => handleGlowChange({ color: e.target.value })}
									className="color-picker-input"
								/>
							</div>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label">Display</div>
			<div className="setting-group">
				<SettingRow icon={Square} label="Screen Corners" desc="Rounded top edges">
					<SettingSwitch checked={cornersEnabled} onToggle={toggleCorners} />
				</SettingRow>

				<SettingRow
					icon={Maximize2}
					label="UI & Font Scale"
					desc={`Adjust desktop size (${Math.round(scale * 100)}%)`}
					divider={false}
				>
					<div className="scale-button-container">
						<button
							onClick={() => handleScaleChange(Math.max(0.8, parseFloat((scale - 0.1).toFixed(1))))}
							disabled={scale <= 0.8}
							className="scale-adjust-btn"
							title="Decrease Scale"
						>
							—
						</button>
						<span className="scale-display-value">{Math.round(scale * 100)}%</span>
						<button
							onClick={() => handleScaleChange(Math.min(1.3, parseFloat((scale + 0.1).toFixed(1))))}
							disabled={scale >= 1.3}
							className="scale-adjust-btn"
							title="Increase Scale"
						>
							+
						</button>
					</div>
				</SettingRow>
			</div>
		</>
	);
}
