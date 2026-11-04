import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceTab } from "./AppearanceTab";
import type { GlassSettings } from "../glassSettings";
import type { GlowSettings } from "../glowSettings";

// Technical boilerplate only: the props these tests do not care about do nothing.
function renderAppearanceTab(props: {
	glass: GlassSettings;
	glow: GlowSettings;
	handleGlassChange?: (change: Partial<GlassSettings>) => void;
	handleGlowChange?: (change: Partial<GlowSettings>) => void;
	themeColor?: string;
}) {
	return render(
		<AppearanceTab
			themeMode="dark"
			handleThemeModeChange={() => {}}
			themeColor="#007aff"
			handleThemeColorChange={() => {}}
			themeOpacity={0.8}
			handleOpacityChange={() => {}}
			themeSaturation={0.5}
			handleSaturationChange={() => {}}
			themeBrightness={0.15}
			handleBrightnessChange={() => {}}
			handleGlassChange={() => {}}
			handleGlowChange={() => {}}
			cornersEnabled={false}
			toggleCorners={() => {}}
			scale={1}
			handleScaleChange={() => {}}
			{...props}
		/>
	);
}

describe("AppearanceTab Liquid Glass", () => {
	it("offers only the switch while glass is off", () => {
		renderAppearanceTab({
			glass: {
				enabled: false,
				edgeShine: 0.6,
				sheen: 0.5,
				edgeWidthPx: 1.5,
				frost: 0.2,
				dispersion: 0.3,
				depth: 0.4
			},
			glow: { enabled: false, color: null, intensity: 0.5 }
		});

		expect(screen.getByRole("switch", { name: "Liquid Glass" })).not.toBeChecked();
		for (const name of [
			"Edge Shine",
			"Edge Thickness",
			"Dispersion",
			"Surface Sheen",
			"Frost",
			"Depth"
		]) {
			expect(screen.queryByRole("slider", { name })).not.toBeInTheDocument();
		}
	});

	it("turns glass on from the switch", async () => {
		const handleGlassChange = vi.fn();
		renderAppearanceTab({
			glass: {
				enabled: false,
				edgeShine: 0.6,
				sheen: 0.5,
				edgeWidthPx: 1.5,
				frost: 0.2,
				dispersion: 0.3,
				depth: 0.4
			},
			glow: { enabled: false, color: null, intensity: 0.5 },
			handleGlassChange
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Liquid Glass" }));

		expect(handleGlassChange).toHaveBeenCalledWith({ enabled: true });
	});

	it("turns glass off from the switch", async () => {
		const handleGlassChange = vi.fn();
		renderAppearanceTab({
			glass: {
				enabled: true,
				edgeShine: 0.6,
				sheen: 0.5,
				edgeWidthPx: 1.5,
				frost: 0.2,
				dispersion: 0.3,
				depth: 0.4
			},
			glow: { enabled: false, color: null, intensity: 0.5 },
			handleGlassChange
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Liquid Glass" }));

		expect(handleGlassChange).toHaveBeenCalledWith({ enabled: false });
	});

	it("shows the current look as sliders once glass is on", () => {
		renderAppearanceTab({
			glass: {
				enabled: true,
				edgeShine: 0.9,
				sheen: 0.2,
				edgeWidthPx: 2.5,
				frost: 0.7,
				dispersion: 0.1,
				depth: 0.8
			},
			glow: { enabled: false, color: null, intensity: 0.5 }
		});

		expect(screen.getByRole("slider", { name: "Edge Shine" })).toHaveValue("0.9");
		expect(screen.getByRole("slider", { name: "Surface Sheen" })).toHaveValue("0.2");
		expect(screen.getByRole("slider", { name: "Edge Thickness" })).toHaveValue("2.5");
		expect(screen.getByRole("slider", { name: "Frost" })).toHaveValue("0.7");
		expect(screen.getByRole("slider", { name: "Dispersion" })).toHaveValue("0.1");
		expect(screen.getByRole("slider", { name: "Depth" })).toHaveValue("0.8");
	});

	it.each([
		["Edge Shine", "0.85", { edgeShine: 0.85 }],
		["Surface Sheen", "0.1", { sheen: 0.1 }],
		["Edge Thickness", "3", { edgeWidthPx: 3 }],
		["Frost", "0.65", { frost: 0.65 }],
		["Dispersion", "0.9", { dispersion: 0.9 }],
		["Depth", "0.25", { depth: 0.25 }]
	])("changes only %s when its slider moves", (name, newValue, expectedChange) => {
		const handleGlassChange = vi.fn();
		renderAppearanceTab({
			glass: {
				enabled: true,
				edgeShine: 0.6,
				sheen: 0.5,
				edgeWidthPx: 1.5,
				frost: 0.2,
				dispersion: 0.3,
				depth: 0.4
			},
			glow: { enabled: false, color: null, intensity: 0.5 },
			handleGlassChange
		});

		fireEvent.change(screen.getByRole("slider", { name }), { target: { value: newValue } });

		expect(handleGlassChange).toHaveBeenCalledWith(expectedChange);
	});
});

describe("AppearanceTab Accent Glow", () => {
	const glassOff: GlassSettings = {
		enabled: false,
		edgeShine: 0.6,
		sheen: 0.5,
		edgeWidthPx: 1.5,
		frost: 0.2,
		dispersion: 0.3,
		depth: 0.4
	};

	it("offers only the switch while the glow is off", () => {
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: false, color: null, intensity: 0.5 }
		});

		expect(screen.getByRole("switch", { name: "Accent Glow" })).not.toBeChecked();
		expect(screen.queryByRole("slider", { name: "Glow Intensity" })).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Glow Color")).not.toBeInTheDocument();
	});

	it("turns the glow on from the switch", async () => {
		const handleGlowChange = vi.fn();
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: false, color: null, intensity: 0.5 },
			handleGlowChange
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Accent Glow" }));

		expect(handleGlowChange).toHaveBeenCalledWith({ enabled: true });
	});

	it("changes the intensity from its slider", () => {
		const handleGlowChange = vi.fn();
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: true, color: null, intensity: 0.5 },
			handleGlowChange
		});

		fireEvent.change(screen.getByRole("slider", { name: "Glow Intensity" }), {
			target: { value: "0.8" }
		});

		expect(handleGlowChange).toHaveBeenCalledWith({ intensity: 0.8 });
	});

	it("says the glow follows the theme until a colour is chosen", () => {
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: true, color: null, intensity: 0.5 }
		});

		expect(screen.getByText("Following the theme accent")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Use theme" })).not.toBeInTheDocument();
	});

	it("saves a colour the user picks", () => {
		const handleGlowChange = vi.fn();
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: true, color: null, intensity: 0.5 },
			handleGlowChange
		});

		fireEvent.change(screen.getByLabelText("Glow Color"), { target: { value: "#ff7a59" } });

		expect(handleGlowChange).toHaveBeenCalledWith({ color: "#ff7a59" });
	});

	it("shows the chosen colour and lets the user go back to the theme accent", async () => {
		const handleGlowChange = vi.fn();
		renderAppearanceTab({
			glass: glassOff,
			glow: { enabled: true, color: "#22c55e", intensity: 0.5 },
			handleGlowChange
		});
		const user = userEvent.setup();

		expect(screen.getByLabelText("Glow Color")).toHaveValue("#22c55e");
		await user.click(screen.getByRole("button", { name: "Use theme" }));

		expect(handleGlowChange).toHaveBeenCalledWith({ color: null });
	});
});
