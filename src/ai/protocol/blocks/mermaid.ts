import { z } from "zod";
import type { BlockContract } from "../types";
import { estimateDiagramHeight } from "../../chat/blocks/mermaidStyle";

// Mermaid's own DSL, not JSON-structured data — the schema only bounds
// length; mermaid.parse() (called client-side before render, see
// MermaidBlock) is what actually validates diagram syntax.
const mermaidSchema = z.object({
	source: z.string().min(1).max(2000)
});

export type MermaidData = z.infer<typeof mermaidSchema>;

export const mermaid: BlockContract<MermaidData> = {
	type: "mermaid",
	schema: mermaidSchema,
	height: (data) => estimateDiagramHeight(data.source),
	doc: {
		summary: "A Mermaid diagram (flowchart, sequence diagram, or entity relationship diagram).",
		whenToUse:
			"Explaining a process, architecture, sequence of interactions, or relationships between a handful of entities where the structure itself is the point.",
		whenNotToUse:
			"Never for numeric/data comparisons — use chart, table, or stat instead. Never for a simple linear list — use a markdown numbered list. Keep diagrams to a handful of nodes; this renders at a fixed ~200px height.",
		example:
			'```zara:mermaid\n{"source":"flowchart TD\\nA[Request] --> B{Cache hit?}\\nB -->|yes| C[Return cached]\\nB -->|no| D[Fetch + store]"}\n```'
	}
};
