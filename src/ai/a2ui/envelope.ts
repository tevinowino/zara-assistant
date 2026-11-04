// The wire format: A2UI v0.9 server-to-client messages, one JSON object per
// line. Each line carries `"version":"v0.9"` and exactly one of createSurface,
// updateComponents, updateDataModel or deleteSurface.
//
// Only the envelope is checked here. Whether a component's own properties are
// valid is the catalog's job (see catalog/), because that is where Zara
// decides what the model may draw.

import { z } from "zod";

export const PROTOCOL_VERSION = "v0.9";

/** Limits that keep a runaway reply from locking the panel. */
export const MAX_ENVELOPE_LINES = 60;
const MAX_LINE_LENGTH = 20_000;

const identifier = z.string().min(1).max(64);

const componentSchema = z
	.object({ id: identifier, component: z.string().min(1).max(32) })
	.passthrough();

const version = z.literal(PROTOCOL_VERSION);

const envelopeSchema = z.union([
	z
		.object({
			version,
			createSurface: z.object({
				surfaceId: identifier,
				catalogId: z.string().min(1).max(200),
				sendDataModel: z.boolean().optional(),
				theme: z.unknown().optional()
			})
		})
		.strict(),
	z
		.object({
			version,
			updateComponents: z.object({
				surfaceId: identifier,
				components: z.array(componentSchema).min(1).max(100)
			})
		})
		.strict(),
	z
		.object({
			version,
			updateDataModel: z.object({
				surfaceId: identifier,
				path: z.string().max(200).optional(),
				value: z.unknown().optional()
			})
		})
		.strict(),
	z.object({ version, deleteSurface: z.object({ surfaceId: identifier }) }).strict()
]);

export type Envelope = z.infer<typeof envelopeSchema>;
export type SurfaceComponent = z.infer<typeof componentSchema>;

export interface ParsedEnvelopes {
	envelopes: Envelope[];
	/** One sentence per rejected line, naming the line and the field. */
	problems: string[];
}

/**
 * Reads a JSONL body into envelopes. Blank lines are skipped. A line that is not
 * valid JSON or not a valid envelope is reported and skipped; the rest still
 * parse, so one bad line does not lose the whole surface.
 */
export function parseEnvelopes(jsonl: string): ParsedEnvelopes {
	const envelopes: Envelope[] = [];
	const problems: string[] = [];
	const lines = jsonl.split(/\r?\n/);

	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const where = `line ${index + 1}`;
		if (envelopes.length + problems.length >= MAX_ENVELOPE_LINES) {
			if (problems.at(-1) !== "too many lines") problems.push("too many lines");
			return;
		}
		if (line.length > MAX_LINE_LENGTH) {
			problems.push(`${where}: line is too long`);
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			problems.push(`${where}: ${error instanceof Error ? error.message : "invalid JSON"}`);
			return;
		}

		const result = envelopeSchema.safeParse(parsed);
		if (result.success) {
			envelopes.push(result.data);
			return;
		}
		const issue = result.error.issues[0];
		problems.push(`${where}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
	});

	return { envelopes, problems };
}
