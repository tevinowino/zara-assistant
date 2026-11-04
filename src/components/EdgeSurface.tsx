import "./EdgeSurface.css";

type Edge = "top" | "bottom" | "left" | "right";

interface EdgeSurfaceProps {
	/** The screen edge the surface hangs from. */
	edge: Edge;
	/** Show the concave flares that bridge the pill to the edge. */
	flares?: boolean;
}

/**
 * Background of a surface attached to a screen edge (the notch and the
 * volume and brightness overlays): the pill plus its two flares, drawn as one
 * layer. Render it as the first child of a positioned, isolated element that
 * sets `--surface-bg`; the pill takes that element's corner radii.
 *
 * When the user turns Liquid Glass on (see glassSettings.ts) a lit rim and a sheen are
 * drawn over the pill by a second layer. It is a sibling, not a child, because the
 * surface layer is masked to the theme colour's alpha, which would dim the light.
 *
 * Likewise the user's accent glow (see glowSettings.ts) is a halo painted behind the
 * surface by its own layer.
 */
export function EdgeSurface({ edge, flares = true }: EdgeSurfaceProps) {
	return (
		<>
			<div className="edge-surface-glow" aria-hidden="true" />
			<div
				className={`edge-surface edge-surface--${edge}${flares ? " show-flares" : ""}`}
				aria-hidden="true"
			>
				<span className="edge-surface-flare edge-surface-flare--start" />
				<span className="edge-surface-flare edge-surface-flare--end" />
			</div>
			<div className="edge-surface-glass" aria-hidden="true" />
		</>
	);
}
