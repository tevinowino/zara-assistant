import { describe, expect, it } from "vitest";
import { ACCENT_HEX } from "../../protocol/accent";
import { chartPaletteFor } from "./chartPalette";

describe("chartPaletteFor", () => {
	it("colours the series from the accent palette, in an order that is easy to tell apart", () => {
		const palette = chartPaletteFor("#ffffff", "rgba(0, 0, 0, 0.92)");

		expect(palette.series.slice(0, 4)).toEqual([
			ACCENT_HEX.blue,
			ACCENT_HEX.green,
			ACCENT_HEX.amber,
			ACCENT_HEX.purple
		]);
	});

	it("has enough distinct colours for a pie of many slices", () => {
		const palette = chartPaletteFor("#ffffff", "rgba(0, 0, 0, 0.92)");

		expect(palette.series).toHaveLength(8);
		expect(new Set(palette.series).size).toBe(8);
	});

	it("uses the colours the model chose, by accent name or hex", () => {
		const palette = chartPaletteFor("#ffffff", "rgba(0, 0, 0, 0.92)", ["red", "#112233"]);

		expect(palette.series[0]).toBe(ACCENT_HEX.red);
		expect(palette.series[1]).toBe("#112233");
		expect(palette.series[2]).toBe(ACCENT_HEX.amber);
	});

	it("ignores a colour it does not recognise instead of breaking the chart", () => {
		const palette = chartPaletteFor("#ffffff", "rgba(0, 0, 0, 0.92)", ["chartreuse", undefined]);

		expect(palette.series[0]).toBe(ACCENT_HEX.blue);
		expect(palette.series[1]).toBe(ACCENT_HEX.green);
	});

	it("draws labels and grid lines in the dark notch's white at low strength", () => {
		const palette = chartPaletteFor("#ffffff", "rgba(0, 0, 0, 0.92)");

		expect(palette.tick).toBe("rgba(255, 255, 255, 0.55)");
		expect(palette.grid).toBe("rgba(255, 255, 255, 0.06)");
	});

	it("draws labels in a light notch's dark text colour so they stay visible", () => {
		const palette = chartPaletteFor("#1c1c1e", "rgba(245, 245, 247, 0.92)");

		expect(palette.tick).toBe("rgba(28, 28, 30, 0.55)");
	});

	it("falls back to white ink when the theme colour is not a 6-digit hex", () => {
		expect(chartPaletteFor("", "rgba(0, 0, 0, 0.9)").tick).toBe("rgba(255, 255, 255, 0.55)");
		expect(chartPaletteFor("red", "rgba(0, 0, 0, 0.9)").tick).toBe("rgba(255, 255, 255, 0.55)");
	});

	it("uses the notch's own background for tooltips", () => {
		expect(chartPaletteFor("#ffffff", "rgba(1, 2, 3, 0.9)").tooltipBackground).toBe(
			"rgba(1, 2, 3, 0.9)"
		);
	});
});
