import { z } from "zod";
import { colorChoiceSchema } from "../accent";
import type { BlockContract } from "../types";

// { x: "Jul", revenue: 12, cost: 8 } — x is the ordered dimension, every
// other key is a plotted series value. Clamped to finite numbers: Recharts
// computes domains from these and throws mid-render on NaN/Infinity, which
// is exactly the white-screen case the schema layer exists to prevent.
const chartDataPointSchema = z
	.object({ x: z.union([z.string(), z.number()]) })
	.catchall(z.number().finite());

const chartSchema = z
	.object({
		kind: z.enum(["line", "bar", "area", "pie"]),
		title: z.string().min(1).max(60).optional(),
		data: z.array(chartDataPointSchema).min(1).max(30),
		// Explicit rather than "every non-x key" — forces the model to say which
		// numeric keys are actually meant to be plotted.
		series: z.array(z.string().min(1).max(20)).min(1).max(4),
		// Positionally matched to series (colors[i] is series[i]'s color) —
		// colors can't live inside a data point, since chartDataPointSchema's
		// catchall requires every extra key to be a number.
		colors: z.array(colorChoiceSchema).max(4).optional()
	})
	.refine((chart) => !chart.colors || chart.colors.length === chart.series.length, {
		message: "colors, if provided, must have exactly one entry per series."
	});

export type ChartData = z.infer<typeof chartSchema>;

export const chart: BlockContract<ChartData> = {
	type: "chart",
	schema: chartSchema,
	height: 160,
	doc: {
		summary:
			'A line, bar, area, or pie chart with up to 4 series over up to 30 points. Optionally set a "colors" array (hex, one entry per series) to use a custom palette instead of the default.',
		whenToUse:
			"3 or more numeric data points over an ordered dimension (time, category) where a visual trend or comparison adds clarity beyond the numbers themselves.",
		whenNotToUse:
			"Never for a single number — write it in the sentence, or use stat for 2-4 standalone numbers. Never for fewer than 3 points or for a qualitative/text comparison.",
		example:
			'```zara:chart\n{"kind":"line","title":"Revenue","data":[{"x":"Jul","revenue":12},{"x":"Aug","revenue":19},{"x":"Sep","revenue":24}],"series":["revenue"]}\n```'
	}
};
