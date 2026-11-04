import type { z } from "zod";
import { stat } from "./blocks/stat";
import { chart } from "./blocks/chart";
import { table } from "./blocks/table";
import { carousel } from "./blocks/carousel";
import { mermaid } from "./blocks/mermaid";

// The only place a block gets registered. Adding a widget also requires a
// renderer component in src/components/chat/blocks/registry.ts — the two
// are joined by a total mapped type there, so a contract without a renderer
// (or vice versa) is a compile error rather than a silent gap.
export const BLOCK_CONTRACTS = { stat, chart, table, carousel, mermaid } as const;

export type ZaraBlockType = keyof typeof BLOCK_CONTRACTS;

export type BlockDataMap = {
	[K in ZaraBlockType]: z.infer<(typeof BLOCK_CONTRACTS)[K]["schema"]>;
};

export const ZARA_BLOCK_TYPES = Object.keys(BLOCK_CONTRACTS) as ZaraBlockType[];

export type { BlockContract, BlockDoc } from "./types";
