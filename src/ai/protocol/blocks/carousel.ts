import { z } from "zod";
import { colorChoiceSchema } from "../accent";
import type { BlockContract } from "../types";

// No image field, deliberately — consistent with the chat markdown
// sanitizer's stance (see src/components/chat/sanitizeSchema.ts): a
// model-authored image URL is an outbound-request/tracking-pixel primitive
// with no upside in a 500px overlay, so neither rendering path allows one.
const carouselItemSchema = z.object({
	title: z.string().min(1).max(40),
	description: z.string().max(140).optional(),
	// Renders as a low-alpha tint + border accent only — never behind the
	// title/description text — so an unusual hue can't make a card illegible.
	color: colorChoiceSchema.optional()
});

const carouselSchema = z.object({
	items: z.array(carouselItemSchema).min(2).max(6)
});

export type CarouselData = z.infer<typeof carouselSchema>;

export const carousel: BlockContract<CarouselData> = {
	type: "carousel",
	schema: carouselSchema,
	height: 180,
	doc: {
		summary:
			'A horizontally-scrollable set of 2-6 titled cards, browsed one at a time. Each item may optionally set its own hex "color" for a distinct accent.',
		whenToUse:
			"3-6 distinct options, recommendations, or next steps the user should browse — product picks, plan tiers, suggested actions.",
		whenNotToUse:
			"Never for fewer than 3 items — use prose or stat. Never for structured data with several fields per item — use table.",
		example:
			'```zara:carousel\n{"items":[{"title":"Starter","description":"Good for small teams"},{"title":"Pro","description":"Unlimited projects"},{"title":"Enterprise","description":"Dedicated support"}]}\n```'
	}
};
