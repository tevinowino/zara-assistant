import { describe, expect, it } from "vitest";
import {
	applyGlowSettings,
	DEFAULT_GLOW_SETTINGS,
	parseGlowSettings,
	serializeGlowSettings
} from "./glowSettings";

describe("parseGlowSettings", () => {
	it("is off, following the theme accent, when nothing was saved", () => {
		expect(parseGlowSettings(null)).toEqual({ enabled: false, color: null, intensity: 0.5 });
	});

	it("reads a saved glow", () => {
		const saved = JSON.stringify({ enabled: true, color: "#ff7a59", intensity: 0.8 });

		expect(parseGlowSettings(saved)).toEqual({
			enabled: true,
			color: "#ff7a59",
			intensity: 0.8
		});
	});

	it("keeps a null colour as following the theme accent", () => {
		const saved = JSON.stringify({ enabled: true, color: null, intensity: 0.3 });

		expect(parseGlowSettings(saved).color).toBeNull();
	});

	it("lowercases the colour so equal colours compare equal", () => {
		expect(parseGlowSettings(JSON.stringify({ color: "#FF7A59" })).color).toBe("#ff7a59");
	});

	it("rejects a colour that is not #rrggbb, following the theme accent instead", () => {
		expect(parseGlowSettings(JSON.stringify({ color: "red" })).color).toBeNull();
		expect(parseGlowSettings(JSON.stringify({ color: "#f00" })).color).toBeNull();
		expect(parseGlowSettings(JSON.stringify({ color: "url(javascript:x)" })).color).toBeNull();
	});

	it("clamps the intensity to 0..1", () => {
		expect(parseGlowSettings(JSON.stringify({ intensity: 4 })).intensity).toBe(1);
		expect(parseGlowSettings(JSON.stringify({ intensity: -2 })).intensity).toBe(0);
	});

	it("uses the default intensity when it is not a number", () => {
		expect(parseGlowSettings(JSON.stringify({ intensity: "strong" })).intensity).toBe(0.5);
	});

	it("falls back to the defaults for text that is not JSON", () => {
		expect(parseGlowSettings("{oops")).toEqual(DEFAULT_GLOW_SETTINGS);
	});

	it("only turns on for an explicit true", () => {
		expect(parseGlowSettings(JSON.stringify({ enabled: 1 })).enabled).toBe(false);
	});

	it("round-trips through serialize", () => {
		const glow = { enabled: true, color: "#22c55e", intensity: 0.25 };

		expect(parseGlowSettings(serializeGlowSettings(glow))).toEqual(glow);
	});
});

describe("applyGlowSettings", () => {
	it("publishes the chosen colour and intensity as CSS variables", () => {
		const root = document.createElement("div");

		applyGlowSettings(root, { enabled: true, color: "#3b82f6", intensity: 0.6 });

		expect(root.dataset.glow).toBe("on");
		expect(root.style.getPropertyValue("--glow-color")).toBe("#3b82f6");
		expect(root.style.getPropertyValue("--glow-intensity")).toBe("0.6");
		expect(root.style.getPropertyValue("--glow-reach")).toBe("20px");
	});

	it("follows the theme accent when no colour is chosen", () => {
		const root = document.createElement("div");

		applyGlowSettings(root, { enabled: true, color: null, intensity: 0.5 });

		expect(root.style.getPropertyValue("--glow-color")).toBe("var(--zara-accent, #007aff)");
	});

	it("marks the page as not glowing when disabled", () => {
		const root = document.createElement("div");

		applyGlowSettings(root, { ...DEFAULT_GLOW_SETTINGS, enabled: false });

		expect(root.dataset.glow).toBe("off");
	});
});
