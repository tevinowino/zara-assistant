import { createLazyModuleLoader } from "../../lib/lazyModule";
import { monochromeCodeTheme } from "../monochromeCodeTheme";

// Mermaid, recharts and the syntax highlighter are each several hundred
// kilobytes. They load the first time a conversation needs one, and only once,
// however many diagrams, charts or code blocks appear.

export const loadMermaid = createLazyModuleLoader(async () => {
	const module = await import("mermaid");
	// How a diagram looks is set for each render (see MermaidBlock), so it
	// follows the user's theme; nothing is configured here.
	return module.default;
});

export const loadRecharts = createLazyModuleLoader(() => import("recharts"));

export const loadSyntaxHighlighter = createLazyModuleLoader(async () => {
	const { Prism } = await import("react-syntax-highlighter");
	return { SyntaxHighlighter: Prism, style: monochromeCodeTheme };
});
