import type React from "react";
import type { ZaraBlockType, BlockDataMap } from "../../protocol";
import { StatBlock } from "./StatBlock";
import { ChartBlock } from "./ChartBlock";
import { TableBlock } from "./TableBlock";
import { CarouselBlock } from "./CarouselBlock";
import { MermaidBlock } from "./MermaidBlock";

export interface BlockRenderProps<T> {
	data: T;
	/** Reserved height in px, resolved from the block's contract. */
	height: number;
}

// A total mapped type over ZaraBlockType: a missing key is a compile error, and so
// is an extra one. That is the drift guarantee between the protocol contracts
// (../../protocol) and these renderers, enforced by tsc with no code generation.
export type BlockRegistry = {
	[K in ZaraBlockType]: React.ComponentType<BlockRenderProps<BlockDataMap[K]>>;
};

export const BLOCK_REGISTRY: BlockRegistry = {
	stat: StatBlock,
	chart: ChartBlock,
	table: TableBlock,
	carousel: CarouselBlock,
	mermaid: MermaidBlock
};
