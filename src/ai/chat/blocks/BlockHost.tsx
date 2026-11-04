import React from "react";
import type { Segment } from "../../protocol/parse";
import { BLOCK_CONTRACTS } from "../../protocol";
import { BLOCK_REGISTRY, type BlockRenderProps } from "./registry";
import { BlockErrorBoundary } from "./BlockErrorBoundary";
import { BlockFallback } from "./BlockFallback";
import { A2uiSurface } from "../../a2ui/A2uiSurface";

interface BlockHostProps {
	segment: Extract<Segment, { kind: "block" | "surface" | "block-error" | "block-pending" }>;
}

/** Draws one widget segment: the widget, a placeholder while it streams, or a fallback card. */
export function BlockHost({ segment }: BlockHostProps) {
	if (segment.kind === "block-error") {
		return <BlockFallback type={segment.type} detail={segment.detail} raw={segment.raw} />;
	}

	if (segment.kind === "surface") {
		return (
			<BlockErrorBoundary blockType="a2ui" raw={segment.raw}>
				{segment.surfaces.map((surface) => (
					<A2uiSurface key={surface.id} surface={surface} />
				))}
			</BlockErrorBoundary>
		);
	}

	if (segment.kind === "block-pending") {
		return (
			<div className="zai-block zai-shimmer">
				<span className="zai-eyebrow">{segment.type} · loading…</span>
			</div>
		);
	}

	const contract = BLOCK_CONTRACTS[segment.type];
	const height =
		typeof contract.height === "function"
			? (contract.height as (data: unknown) => number)(segment.data)
			: contract.height;

	// The parser already validated segment.data against this block's schema before
	// producing a "block" segment (see parse.ts). TypeScript cannot see that through
	// Segment's `data: unknown`, so this is the one deliberate narrowing point.
	const Component = BLOCK_REGISTRY[segment.type] as React.ComponentType<BlockRenderProps<unknown>>;

	return (
		<BlockErrorBoundary blockType={segment.type} raw={segment.raw}>
			<Component data={segment.data} height={height} />
		</BlockErrorBoundary>
	);
}
