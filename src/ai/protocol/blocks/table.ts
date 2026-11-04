import { z } from "zod";
import type { BlockContract } from "../types";

const tableSchema = z
	.object({
		columns: z.array(z.string().min(1).max(24)).min(1).max(4),
		rows: z
			.array(z.array(z.union([z.string(), z.number()])))
			.min(1)
			.max(12)
	})
	.refine((table) => table.rows.every((row) => row.length === table.columns.length), {
		message: "Every row must have exactly as many cells as there are columns."
	});

export type TableData = z.infer<typeof tableSchema>;

// Table height scales with row count rather than a single fixed value —
// contract.height accepts data as an argument for exactly this case — but is
// still capped and never a CSS percentage: an auto-height chat bubble parent
// measuring a percentage height collapses to zero and never recovers.
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 32;
const MAX_HEIGHT = 240;

export const table: BlockContract<TableData> = {
	type: "table",
	schema: tableSchema,
	height: (data) => Math.min(HEADER_HEIGHT + data.rows.length * ROW_HEIGHT, MAX_HEIGHT),
	doc: {
		summary: "A sortable table with up to 4 columns and up to 12 rows.",
		whenToUse:
			"Structured multi-field records (3 or more rows) the user should scan or compare — pricing tiers, spec sheets, search results.",
		whenNotToUse:
			"Never for 1-2 items — write them in prose. Never for a single-column list — use a markdown bullet list instead.",
		example:
			'```zara:table\n{"columns":["Model","Price","Speed"],"rows":[["A","$10","Fast"],["B","$8","Medium"]]}\n```'
	}
};
