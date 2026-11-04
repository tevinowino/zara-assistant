import { BLOCK_CONTRACTS, ZARA_BLOCK_TYPES, type ZaraBlockType } from "./index";
import { readSurfaces, type ValidSurface } from "../a2ui";

export type BlockParseFailureReason =
	| "unknown-type" // ```zara:sankey — not in BLOCK_CONTRACTS
	| "invalid-surface" // ```a2ui — the body held no usable surface
	| "invalid-json" // JSON.parse threw
	| "schema-mismatch" // Zod safeParse failed
	| "unterminated"; // fence never closed and the message is complete

export type Segment =
	| { kind: "markdown"; index: number; text: string }
	| {
			kind: "block";
			index: number;
			type: ZaraBlockType;
			data: unknown;
			raw: string;
	  }
	| { kind: "surface"; index: number; surfaces: ValidSurface[]; raw: string }
	| { kind: "block-pending"; index: number; type: string; raw: string }
	| {
			kind: "block-error";
			index: number;
			type: string;
			raw: string;
			reason: BlockParseFailureReason;
			detail: string;
	  };

export interface ParseOptions {
	/** True while the message is still streaming in — an unterminated fence at
	 *  EOF is a normal, temporary state ("block-pending"), not a failure. */
	streaming?: boolean;
}

// A fence delimiter must start at column 0-3 of a line (CommonMark). This is
// what makes the parser safe against backticks inside a JSON string value:
// JSON cannot contain a raw newline inside a string literal, so a ``` run
// inside a block's payload can never be the first non-space content of a
// physical line — every payload line begins with `{`, `}`, `[`, `]`, `"`, a
// digit, or whitespace.
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenFence {
	char: string;
	length: number;
	isZaraBlock: boolean;
	type: string;
	/** Body lines only (JSON payload), used to parse zara blocks. */
	bodyLines: string[];
	/** Every line including both delimiters, used for the reconstructed `raw`
	 *  and for passthrough of non-zara fences straight into prose. */
	rawLines: string[];
}

/** The info string that opens a fence holding A2UI messages. */
const SURFACE_FENCE_TYPE = "a2ui";

function isZaraBlockContract(type: string): type is ZaraBlockType {
	return (ZARA_BLOCK_TYPES as readonly string[]).includes(type);
}

function parseBlockBody(
	type: string,
	body: string
): { data: unknown } | { reason: BlockParseFailureReason; detail: string } {
	if (!isZaraBlockContract(type)) {
		return { reason: "unknown-type", detail: `Unknown block type "${type}".` };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		return {
			reason: "invalid-json",
			detail: error instanceof Error ? error.message : String(error)
		};
	}

	const result = BLOCK_CONTRACTS[type].schema.safeParse(parsed);
	if (!result.success) {
		const issue = result.error.issues[0];
		const path = issue.path.join(".") || "(root)";
		return { reason: "schema-mismatch", detail: `${path}: ${issue.message}` };
	}

	return { data: result.data };
}

export function parseMessageContent(raw: string, opts: ParseOptions = {}): Segment[] {
	const segments: Segment[] = [];
	let index = 0;
	let proseLines: string[] = [];
	let fence: OpenFence | null = null;

	const flushProse = () => {
		const text = proseLines.join("\n");
		proseLines = [];
		if (text.trim() === "") return;
		segments.push({ kind: "markdown", index: index++, text });
	};

	const closeSurfaceFence = (raw: string, body: string) => {
		const { surfaces, problems } = readSurfaces(body);
		if (surfaces.length > 0) {
			segments.push({ kind: "surface", index: index++, surfaces, raw });
		} else {
			segments.push({
				kind: "block-error",
				index: index++,
				type: SURFACE_FENCE_TYPE,
				raw,
				reason: "invalid-surface",
				detail: problems[0] ?? "The surface was empty."
			});
		}
	};

	const closeZaraFence = (openFence: OpenFence) => {
		const raw = openFence.rawLines.join("\n");
		const body = openFence.bodyLines.join("\n");
		if (openFence.type === SURFACE_FENCE_TYPE) {
			closeSurfaceFence(raw, body);
			return;
		}
		const result = parseBlockBody(openFence.type, body);
		if ("data" in result) {
			segments.push({
				kind: "block",
				index: index++,
				type: openFence.type as ZaraBlockType,
				data: result.data,
				raw
			});
		} else {
			segments.push({
				kind: "block-error",
				index: index++,
				type: openFence.type,
				raw,
				reason: result.reason,
				detail: result.detail
			});
		}
	};

	const lines = raw.split(/\r?\n/);

	for (const line of lines) {
		if (!fence) {
			const openMatch = line.match(FENCE_LINE_PATTERN);
			if (!openMatch) {
				proseLines.push(line);
				continue;
			}

			const [, run, info] = openMatch;
			const infoTrimmed = info.trim();
			const firstToken = infoTrimmed.split(/\s+/)[0] ?? "";
			const lowered = firstToken.toLowerCase();
			const isSurface = lowered === SURFACE_FENCE_TYPE;
			const isZaraBlock = lowered.startsWith("zara:") || isSurface;

			if (isZaraBlock) {
				flushProse();
			}
			// Non-zara fences (```python, plain ```, etc.) stay inside the
			// surrounding markdown segment untouched — react-markdown owns them.

			fence = {
				char: run[0],
				length: run.length,
				isZaraBlock,
				type: isSurface ? SURFACE_FENCE_TYPE : isZaraBlock ? firstToken.slice("zara:".length) : "",
				bodyLines: [],
				rawLines: [line]
			};
			if (!isZaraBlock) {
				proseLines.push(line);
			}
			continue;
		}

		// Inside a fence: only a same-char, at-least-as-long, no-info-string
		// line closes it (CommonMark). Fences do not nest — a shorter or
		// different-char backtick run inside is inert body content.
		const closeMatch = line.match(FENCE_LINE_PATTERN);
		const closes =
			closeMatch !== null &&
			closeMatch[1][0] === fence.char &&
			closeMatch[1].length >= fence.length &&
			closeMatch[2].trim() === "";

		if (closes) {
			fence.rawLines.push(line);
			if (fence.isZaraBlock) {
				closeZaraFence(fence);
			} else {
				proseLines.push(line);
			}
			fence = null;
			continue;
		}

		fence.rawLines.push(line);
		if (fence.isZaraBlock) {
			fence.bodyLines.push(line);
		} else {
			proseLines.push(line);
		}
	}

	if (fence?.isZaraBlock) {
		const raw = fence.rawLines.join("\n");
		if (opts.streaming) {
			segments.push({
				kind: "block-pending",
				index: index++,
				type: fence.type,
				raw
			});
		} else {
			segments.push({
				kind: "block-error",
				index: index++,
				type: fence.type,
				raw,
				reason: "unterminated",
				detail: "Block fence was never closed."
			});
		}
	} else {
		flushProse();
	}

	return segments;
}
