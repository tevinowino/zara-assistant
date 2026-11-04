import { describe, expect, it } from "vitest";
import { ACCENT_HEX, ACCENT_NAMES } from "../../protocol/accent";
import {
	fitDiagramHeight,
	mermaidThemeVariables,
	mixHex,
	parseCssColorToHex,
	withAccentClasses
} from "./mermaidStyle";

describe("mixHex", () => {
	it("blends two colours by weight", () => {
		expect(mixHex("#ff0000", "#000000", 0.5)).toBe("#800000");
	});

	it("is the first colour at full weight and the second at none", () => {
		expect(mixHex("#3b82f6", "#000000", 1)).toBe("#3b82f6");
		expect(mixHex("#3b82f6", "#102030", 0)).toBe("#102030");
	});
});

describe("parseCssColorToHex", () => {
	it("keeps a 6-digit hex", () => {
		expect(parseCssColorToHex("#112233", "#000000")).toBe("#112233");
	});

	it("reads rgb and rgba and ignores the alpha", () => {
		expect(parseCssColorToHex("rgba(0, 0, 0, 0.92)", "#ffffff")).toBe("#000000");
		expect(parseCssColorToHex("rgb(245, 245, 247)", "#000000")).toBe("#f5f5f7");
	});

	it("falls back for anything it cannot read", () => {
		expect(parseCssColorToHex("", "#123456")).toBe("#123456");
		expect(parseCssColorToHex("hotpink", "#123456")).toBe("#123456");
	});
});

describe("mermaidThemeVariables", () => {
	const variables = mermaidThemeVariables("#ffffff", "#000000");

	it("draws text in the notch's own text colour", () => {
		expect(variables.primaryTextColor).toBe("#ffffff");
		expect(variables.textColor).toBe("#ffffff");
	});

	it("fills nodes with a tint of the blue accent and outlines them in it", () => {
		expect(variables.primaryColor).toBe(mixHex(ACCENT_HEX.blue, "#000000", 0.24));
		expect(variables.primaryBorderColor).toBe(ACCENT_HEX.blue);
	});

	it("draws connecting lines in a muted tint of the text colour", () => {
		expect(variables.lineColor).toBe(mixHex("#ffffff", "#000000", 0.55));
	});

	it("is built from the theme, so a light notch gets light node fills", () => {
		const light = mermaidThemeVariables("#1c1c1e", "#f5f5f7");

		expect(light.primaryTextColor).toBe("#1c1c1e");
		expect(light.primaryColor).toBe(mixHex(ACCENT_HEX.blue, "#f5f5f7", 0.24));
	});
});

describe("withAccentClasses", () => {
	it("adds a class for every accent to a flowchart so the model can colour nodes", () => {
		const source = withAccentClasses("flowchart TD\nA --> B", "#ffffff", "#000000");

		expect(source.startsWith("flowchart TD\nA --> B")).toBe(true);
		for (const name of ACCENT_NAMES) {
			expect(source).toContain(`classDef ${name} fill:`);
		}
	});

	it("does the same for the older graph keyword", () => {
		expect(withAccentClasses("graph LR\nA --> B", "#fff", "#000")).toContain(
			"classDef green fill:"
		);
	});

	it("leaves other kinds of diagram alone", () => {
		const sequence = "sequenceDiagram\nA->>B: hi";

		expect(withAccentClasses(sequence, "#ffffff", "#000000")).toBe(sequence);
	});

	it("does not redefine a class the diagram already defines", () => {
		const source = withAccentClasses(
			"flowchart TD\nA:::green --> B\nclassDef green fill:#000,stroke:#fff",
			"#ffffff",
			"#000000"
		);

		expect(source.match(/classDef green /g)).toHaveLength(1);
		expect(source).toContain("classDef red fill:");
	});

	it("finds the diagram type after a blank line or a comment", () => {
		const source = withAccentClasses("\n%% a note\nflowchart TD\nA --> B", "#ffffff", "#000000");

		expect(source).toContain("classDef blue fill:");
	});
});

describe("fitDiagramHeight", () => {
	it("keeps the diagram's shape at the width it is drawn", () => {
		expect(fitDiagramHeight({ viewBoxWidth: 800, viewBoxHeight: 400, width: 400 })).toBe(200);
	});

	it("never goes below a readable minimum", () => {
		expect(fitDiagramHeight({ viewBoxWidth: 800, viewBoxHeight: 40, width: 400 })).toBe(140);
	});

	it("never goes above the maximum, after which the diagram scrolls", () => {
		expect(fitDiagramHeight({ viewBoxWidth: 200, viewBoxHeight: 900, width: 400 })).toBe(380);
	});

	it("gives the minimum when nothing can be measured", () => {
		expect(fitDiagramHeight({ viewBoxWidth: 0, viewBoxHeight: 0, width: 0 })).toBe(140);
	});
});
