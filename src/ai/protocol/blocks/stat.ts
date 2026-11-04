import { z } from "zod";
import type { BlockContract } from "../types";

const statItemSchema = z.object({
	label: z.string().min(1).max(40),
	value: z.string().min(1).max(24),
	delta: z.string().max(16).optional(),
	trend: z.enum(["up", "down", "flat"]).optional()
});

const statSchema = z.object({
	items: z.array(statItemSchema).min(1).max(4)
});

export type StatData = z.infer<typeof statSchema>;

export const stat: BlockContract<StatData> = {
	type: "stat",
	schema: statSchema,
	height: 84,
	doc: {
		summary: "A row of up to 4 labeled metric cards, each with an optional trend delta.",
		whenToUse:
			"Highlighting 2-4 standalone key numbers side by side (e.g. revenue, active users, conversion rate) that the user should compare at a glance.",
		whenNotToUse:
			"Never for a single number — write it directly in the sentence instead. Never for a series of values over time (use chart) or a full record with many fields (use table).",
		example:
			'```zara:stat\n{"items":[{"label":"Revenue","value":"$482K","delta":"+12%","trend":"up"},{"label":"Churn","value":"2.1%","delta":"-0.4%","trend":"down"}]}\n```'
	}
};
