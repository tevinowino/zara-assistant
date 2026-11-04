// How diagrams look: Mermaid's theme built from the notch's own colours and the
// accent palette, colour classes the model can use on flowchart nodes, and the
// height a diagram is given. All pure, so the look can be tested without
// rendering anything.

import { ACCENT_HEX, ACCENT_NAMES } from "../../protocol/accent";

const SHORT_HEX = /^#[0-9a-fA-F]{6}$/;
const MINIMUM_HEIGHT = 140;
const MAXIMUM_HEIGHT = 380;

function channels(hex: string): [number, number, number] {
	return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [
		number,
		number,
		number
	];
}

function toHex(value: number): string {
	return Math.round(value).toString(16).padStart(2, "0");
}

/** `first` blended with `second`: weight 1 is all `first`, 0 is all `second`. Both are 6-digit hex. */
export function mixHex(first: string, second: string, weightOfFirst: number): string {
	const a = channels(first);
	const b = channels(second);
	const mixed = a.map((value, index) => value * weightOfFirst + b[index] * (1 - weightOfFirst));
	return `#${mixed.map(toHex).join("")}`;
}

/** A CSS colour (hex, rgb or rgba) as 6-digit hex, ignoring alpha; `fallback` for anything else. */
export function parseCssColorToHex(css: string, fallback: string): string {
	const text = css.trim();
	if (SHORT_HEX.test(text)) return text.toLowerCase();
	const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
	if (!match) return fallback;
	return `#${[match[1], match[2], match[3]].map((part) => toHex(Math.min(255, Number(part)))).join("")}`;
}

/**
 * Mermaid's `themeVariables` for the base theme, from the notch's text colour
 * and background (6-digit hex). Nodes are a tint of the blue accent with a blue
 * outline; lines and secondary text are a muted tint of the text colour.
 */
export function mermaidThemeVariables(ink: string, background: string): Record<string, string> {
	const blue = ACCENT_HEX.blue;
	const tint = (accent: string) => mixHex(accent, background, 0.24);
	const muted = mixHex(ink, background, 0.55);
	return {
		background: "transparent",
		fontFamily: "Inter, system-ui, sans-serif",
		fontSize: "12px",
		textColor: ink,
		primaryColor: tint(blue),
		primaryTextColor: ink,
		primaryBorderColor: blue,
		secondaryColor: tint(ACCENT_HEX.purple),
		secondaryTextColor: ink,
		secondaryBorderColor: ACCENT_HEX.purple,
		tertiaryColor: tint(ACCENT_HEX.teal),
		tertiaryTextColor: ink,
		tertiaryBorderColor: ACCENT_HEX.teal,
		mainBkg: tint(blue),
		nodeBorder: blue,
		clusterBkg: mixHex(ink, background, 0.05),
		clusterBorder: mixHex(ink, background, 0.2),
		lineColor: muted,
		edgeLabelBackground: background,
		// Sequence diagrams
		actorBkg: tint(blue),
		actorBorder: blue,
		actorTextColor: ink,
		actorLineColor: muted,
		signalColor: muted,
		signalTextColor: ink,
		noteBkgColor: tint(ACCENT_HEX.amber),
		noteBorderColor: ACCENT_HEX.amber,
		noteTextColor: ink,
		activationBkgColor: tint(blue),
		activationBorderColor: blue
	};
}

/** Extra CSS applied to every diagram: softer corners on nodes and groups. */
export const MERMAID_THEME_CSS = `
.node rect, .node .label-container { rx: 10px; ry: 10px; }
.cluster rect { rx: 12px; ry: 12px; }
.edgePath path.path, .flowchart-link { stroke-width: 1.6px; }
.nodeLabel, .label text, .edgeLabel { font-weight: 500; }
`;

function isFlowchart(source: string): boolean {
	const firstLine = source
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "" && !line.startsWith("%%"));
	return firstLine !== undefined && /^(flowchart|graph)\b/i.test(firstLine);
}

/**
 * The diagram source with a `classDef` per accent added to flowcharts, so the
 * model can colour a node with `A:::green`. Classes the diagram already defines
 * are left as it wrote them; other kinds of diagram are returned unchanged.
 */
export function withAccentClasses(source: string, ink: string, background: string): string {
	if (!isFlowchart(source)) return source;
	const definitions = ACCENT_NAMES.filter(
		(name) => !new RegExp(`classDef\\s+${name}\\b`).test(source)
	).map((name) => {
		const accent = ACCENT_HEX[name];
		return `classDef ${name} fill:${mixHex(accent, background, 0.28)},stroke:${accent},color:${ink},stroke-width:1.6px`;
	});
	return definitions.length === 0 ? source : `${source}\n${definitions.join("\n")}`;
}

/**
 * The height for a rendered diagram: its own shape at the width it is drawn,
 * kept between a readable minimum and a maximum (beyond which it scrolls).
 */
export function fitDiagramHeight({
	viewBoxWidth,
	viewBoxHeight,
	width
}: {
	viewBoxWidth: number;
	viewBoxHeight: number;
	width: number;
}): number {
	if (viewBoxWidth <= 0 || viewBoxHeight <= 0 || width <= 0) return MINIMUM_HEIGHT;
	const natural = (width * viewBoxHeight) / viewBoxWidth;
	return Math.round(Math.min(MAXIMUM_HEIGHT, Math.max(MINIMUM_HEIGHT, natural)));
}

/** A first guess at a diagram's height from its source, before it has been drawn. */
export function estimateDiagramHeight(source: string): number {
	const lines = source.split("\n").filter((line) => line.trim() !== "").length;
	return Math.min(MAXIMUM_HEIGHT, Math.max(MINIMUM_HEIGHT, 90 + lines * 26));
}
