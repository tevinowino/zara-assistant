import type { CSSProperties } from "react";

/**
 * Syntax colouring for code in answers, in the notch's black and white: every
 * token is the panel's text colour at a different strength or weight, so the
 * theme works on a dark or a light notch and never adds a hue. A Prism style
 * object for react-syntax-highlighter.
 */
const ink = (percent: number) => `color-mix(in srgb, currentColor ${percent}%, transparent)`;

const plain: CSSProperties = { color: "inherit" };
const quiet: CSSProperties = { color: ink(55) };
const medium: CSSProperties = { color: ink(80) };
const strong: CSSProperties = { color: "inherit", fontWeight: 600 };

export const monochromeCodeTheme: Record<string, CSSProperties> = {
	'code[class*="language-"]': { color: "inherit", background: "none", textShadow: "none" },
	'pre[class*="language-"]': { color: "inherit", background: "none", textShadow: "none" },
	comment: { ...quiet, fontStyle: "italic" },
	prolog: quiet,
	doctype: quiet,
	cdata: quiet,
	punctuation: quiet,
	operator: medium,
	entity: medium,
	url: medium,
	string: medium,
	char: medium,
	"attr-value": medium,
	builtin: medium,
	inserted: medium,
	regex: medium,
	variable: medium,
	property: plain,
	tag: plain,
	boolean: plain,
	number: plain,
	constant: plain,
	symbol: plain,
	deleted: quiet,
	selector: medium,
	"attr-name": medium,
	function: plain,
	"class-name": strong,
	keyword: strong,
	atrule: strong,
	important: strong,
	bold: { fontWeight: 600 },
	italic: { fontStyle: "italic" }
};
