import { useEffect, useRef, useState, useId } from "react";
import DOMPurify from "dompurify";
import type { BlockDataMap } from "../../protocol";
import type { BlockRenderProps } from "./registry";
import { loadMermaid } from "./loaders";
import { BlockFallback } from "./BlockFallback";
import {
	MERMAID_THEME_CSS,
	fitDiagramHeight,
	mermaidThemeVariables,
	parseCssColorToHex,
	withAccentClasses
} from "./mermaidStyle";

type MermaidData = BlockDataMap["mermaid"];

type RenderState =
	| { status: "loading" }
	| { status: "ok"; svg: string }
	| { status: "error"; detail: string };

// mermaid.render() rejecting never reaches BlockErrorBoundary (error boundaries
// only catch synchronous render errors), so every failure here, whether a parse
// failure or a render rejection, goes through local state into the same
// BlockFallback the boundary uses.
/** The notch's text and background colours as hex, read from the live theme. */
function currentThemeColors(): { ink: string; background: string } {
	const style = getComputedStyle(document.documentElement);
	return {
		ink: parseCssColorToHex(style.getPropertyValue("--zara-text"), "#ffffff"),
		background: parseCssColorToHex(style.getPropertyValue("--zara-bg-expanded"), "#000000")
	};
}

export function MermaidBlock({ data, height }: BlockRenderProps<MermaidData>) {
	const reactId = useId();
	// Mermaid uses this as a real DOM id; React's useId() contains colons, which
	// are not safe there.
	const diagramId = `zara-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const containerRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<RenderState>({ status: "loading" });
	// The height the drawn diagram wants at the width it is shown; until it is
	// drawn, the estimate the block was given is used.
	const [fitHeight, setFitHeight] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function run() {
			try {
				// Mermaid measures text through the DOM to size its boxes. Rendering
				// before the real font is available sizes every box for a fallback font.
				if (document.fonts && "ready" in document.fonts) {
					await document.fonts.ready;
				}

				const mermaidLib = await loadMermaid();
				if (cancelled) return;

				// Validate before touching the DOM, which avoids both a throw and
				// Mermaid's own DOM side effects on invalid input.
				const isValid = await mermaidLib.parse(data.source, { suppressErrors: true });
				if (!isValid) {
					if (!cancelled) setState({ status: "error", detail: "Invalid diagram syntax." });
					return;
				}

				// Look: the notch's colours, an accent-coloured node style, soft corners,
				// and text drawn as SVG (HTML labels would be stripped below).
				const { ink, background } = currentThemeColors();
				mermaidLib.initialize({
					startOnLoad: false,
					// Diagram source is written by the model, not by us. "strict" disables click
					// handlers and raw HTML labels, the right posture for untrusted input.
					securityLevel: "strict",
					suppressErrorRendering: true,
					theme: "base",
					themeVariables: mermaidThemeVariables(ink, background),
					themeCSS: MERMAID_THEME_CSS,
					htmlLabels: false,
					flowchart: {
						htmlLabels: false,
						curve: "basis",
						padding: 14,
						nodeSpacing: 36,
						rankSpacing: 40,
						useMaxWidth: true
					},
					sequence: { useMaxWidth: true, mirrorActors: false }
				});
				const styled = withAccentClasses(data.source, ink, background);
				const { svg } = await mermaidLib.render(diagramId, styled);
				if (!cancelled) setState({ status: "ok", svg });
			} catch (error) {
				if (!cancelled) {
					setState({
						status: "error",
						detail: error instanceof Error ? error.message : String(error)
					});
				}
			}
		}

		run();
		return () => {
			cancelled = true;
		};
	}, [data.source, diagramId]);

	useEffect(() => {
		if (state.status !== "ok" || !containerRef.current) return;
		const svg = containerRef.current.querySelector("svg");
		if (!svg) return;

		// Mermaid's intrinsic size would otherwise widen the panel.
		svg.removeAttribute("width");
		svg.removeAttribute("height");
		svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
		svg.style.width = "100%";
		svg.style.height = "auto";
		svg.style.maxWidth = "100%";

		// Give the diagram the height its own shape asks for at this width.
		const viewBox = svg.viewBox?.baseVal;
		const width = containerRef.current.clientWidth;
		if (viewBox && viewBox.width > 0 && width > 0) {
			setFitHeight(
				fitDiagramHeight({
					viewBoxWidth: viewBox.width,
					viewBoxHeight: viewBox.height,
					width
				})
			);
		}

		// Belt and braces on top of DOMPurify: remove anything that should not be in
		// a diagram, however it got there.
		svg.querySelectorAll("script, foreignObject").forEach((el) => el.remove());
		svg.querySelectorAll("*").forEach((el) => {
			for (const attr of [...el.attributes]) {
				if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
			}
		});
	}, [state]);

	if (state.status === "error") {
		return (
			<BlockFallback
				type="mermaid"
				detail={state.detail}
				raw={"```zara:mermaid\n" + JSON.stringify({ source: data.source }) + "\n```"}
			/>
		);
	}

	if (state.status === "loading") {
		// Reserves the final height from the first paint, so the diagram arriving
		// later causes no layout change.
		return <div className="zai-block zai-shimmer" style={{ height }} />;
	}

	const sanitizedSvg = DOMPurify.sanitize(state.svg, {
		USE_PROFILES: { svg: true, svgFilters: true }
	});

	return (
		<div
			ref={containerRef}
			className="zai-block zai-diagram"
			style={{ height: fitHeight ?? height }}
			dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
		/>
	);
}
