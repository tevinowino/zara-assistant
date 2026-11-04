import { describe, expect, it } from "vitest";
import {
	applyGlassSettings,
	DEFAULT_GLASS_SETTINGS,
	parseGlassSettings,
	serializeGlassSettings
} from "./glassSettings";

describe("parseGlassSettings", () => {
	it("is off with the default look when nothing was saved", () => {
		expect(parseGlassSettings(null)).toEqual({
			enabled: false,
			edgeShine: 0.6,
			sheen: 0.5,
			edgeWidthPx: 1.5,
			frost: 0.2,
			dispersion: 0.3,
			depth: 0.4
		});
	});

	it("reads a saved setting", () => {
		const saved = JSON.stringify({
			enabled: true,
			edgeShine: 0.9,
			sheen: 0.2,
			edgeWidthPx: 2.5,
			frost: 0.7,
			dispersion: 0.1,
			depth: 0.8
		});

		expect(parseGlassSettings(saved)).toEqual({
			enabled: true,
			edgeShine: 0.9,
			sheen: 0.2,
			edgeWidthPx: 2.5,
			frost: 0.7,
			dispersion: 0.1,
			depth: 0.8
		});
	});

	it("falls back to the defaults for text that is not JSON", () => {
		expect(parseGlassSettings("{not json")).toEqual(DEFAULT_GLASS_SETTINGS);
	});

	it("falls back to the defaults for JSON that is not an object", () => {
		expect(parseGlassSettings("42")).toEqual(DEFAULT_GLASS_SETTINGS);
	});

	it("clamps numbers outside their range", () => {
		const saved = JSON.stringify({
			enabled: true,
			edgeShine: 7,
			sheen: -3,
			edgeWidthPx: 40,
			frost: 9,
			dispersion: -1,
			depth: 2
		});

		expect(parseGlassSettings(saved)).toEqual({
			enabled: true,
			edgeShine: 1,
			sheen: 0,
			edgeWidthPx: 3,
			frost: 1,
			dispersion: 0,
			depth: 1
		});
	});

	it("replaces a missing or non-numeric field with its default, keeping the others", () => {
		const saved = JSON.stringify({ enabled: true, edgeShine: "bright", sheen: 0.1 });

		expect(parseGlassSettings(saved)).toEqual({
			enabled: true,
			edgeShine: 0.6,
			sheen: 0.1,
			edgeWidthPx: 1.5,
			frost: 0.2,
			dispersion: 0.3,
			depth: 0.4
		});
	});

	it("reads a setting saved before frost, dispersion and depth existed", () => {
		const savedByAnOlderVersion = JSON.stringify({
			enabled: true,
			edgeShine: 0.9,
			sheen: 0.3,
			edgeWidthPx: 2
		});

		expect(parseGlassSettings(savedByAnOlderVersion)).toEqual({
			enabled: true,
			edgeShine: 0.9,
			sheen: 0.3,
			edgeWidthPx: 2,
			frost: 0.2,
			dispersion: 0.3,
			depth: 0.4
		});
	});

	it("only turns on for an explicit true", () => {
		expect(parseGlassSettings(JSON.stringify({ enabled: "yes" })).enabled).toBe(false);
	});

	it("round-trips through serialize", () => {
		const glass = {
			enabled: true,
			edgeShine: 0.3,
			sheen: 0.8,
			edgeWidthPx: 2,
			frost: 0.5,
			dispersion: 0.6,
			depth: 0.9
		};

		expect(parseGlassSettings(serializeGlassSettings(glass))).toEqual(glass);
	});
});

describe("applyGlassSettings", () => {
	it("marks the page as glass and publishes the look as CSS variables", () => {
		const root = document.createElement("div");

		applyGlassSettings(root, {
			enabled: true,
			edgeShine: 0.4,
			sheen: 0.7,
			edgeWidthPx: 2,
			frost: 0.35,
			dispersion: 0.15,
			depth: 0.85
		});

		expect(root.dataset.glass).toBe("on");
		expect(root.style.getPropertyValue("--glass-shine")).toBe("0.4");
		expect(root.style.getPropertyValue("--glass-sheen")).toBe("0.7");
		expect(root.style.getPropertyValue("--glass-edge-width")).toBe("2px");
		expect(root.style.getPropertyValue("--glass-frost")).toBe("0.35");
		expect(root.style.getPropertyValue("--glass-dispersion")).toBe("0.15");
		expect(root.style.getPropertyValue("--glass-depth")).toBe("0.85");
	});

	it("marks the page as not glass when disabled", () => {
		const root = document.createElement("div");

		applyGlassSettings(root, { ...DEFAULT_GLASS_SETTINGS, enabled: false });

		expect(root.dataset.glass).toBe("off");
	});
});
