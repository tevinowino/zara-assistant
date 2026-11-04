import { z } from "zod";

// Shared by any block that lets the model pick its own color (chart series,
// carousel item accents) — a single validation rule so the format can't
// drift between blocks.
export const hexColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex color, e.g. #8b5cf6");

// Prompt documentation for a block. Lives next to the schema it describes
// (see blocks/*.ts) so the two can never drift silently — the registry
// invariant tests in index.test.ts assert every doc.example actually
// validates against its own schema.
export interface BlockDoc {
	/** One line: what this widget is. */
	summary: string;
	/** Positive trigger, e.g. "3+ numeric data points over an ordered dimension". */
	whenToUse: string;
	/** Negative trigger. Models obey prohibitions far more reliably than a
	 *  global "be sparing" instruction, so this is required, not optional. */
	whenNotToUse: string;
	/** A complete ```zara:<type> fence, verbatim, that the model can pattern-match. */
	example: string;
}

export interface BlockContract<T> {
	readonly type: string;
	readonly schema: z.ZodType<T>;
	readonly doc: BlockDoc;
	/** Fixed CSS pixel height the renderer reserves for this block. Never a
	 *  percentage — see the ResponsiveContainer height rule in the Recharts
	 *  blocks: an auto-height parent measuring a percentage height collapses
	 *  to zero and never recovers. */
	readonly height: number | ((data: T) => number);
}
