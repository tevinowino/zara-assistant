/**
 * Turns a model's reasoning, which arrives as loose text, into something the
 * panel can lay out: thoughts with an optional title, each made of paragraphs
 * and bullet lists. It reads the few shapes reasoning models actually write
 * (a bold or `##` title line, blank-line paragraphs, `-`/`*`/`1.` lists) and
 * treats everything else as plain paragraphs. It is deliberately not Markdown:
 * nothing in it can become a link, an image or markup.
 */

export type ReasoningBlock =
	| { kind: "paragraph"; text: string }
	| { kind: "list"; items: string[] };

export interface Thought {
	/** The thought's own heading, or null when the model wrote none. */
	title: string | null;
	blocks: ReasoningBlock[];
}

const TITLE_LINE = /^(?:\*\*(.+?)\*\*|__(.+?)__|#{1,4}\s+(.+?))\s*:?\s*$/;
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s+(.*)$/;

function titleOf(block: string): string | null {
	if (block.includes("\n")) return null;
	const match = TITLE_LINE.exec(block.trim());
	if (!match) return null;
	return (match[1] ?? match[2] ?? match[3] ?? "").trim() || null;
}

/** The paragraphs and lists inside one blank-line-separated block of text. */
function blocksOf(block: string): ReasoningBlock[] {
	const blocks: ReasoningBlock[] = [];
	let paragraph: string[] = [];
	let items: string[] = [];
	const flush = () => {
		if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
		if (items.length > 0) blocks.push({ kind: "list", items });
		paragraph = [];
		items = [];
	};
	for (const raw of block.split("\n")) {
		const line = raw.trim();
		if (line === "") continue;
		const item = LIST_ITEM.exec(line);
		if (item) {
			if (paragraph.length > 0) flush();
			items.push(item[1]);
		} else if (items.length > 0 && /^\s/.test(raw)) {
			// An indented continuation of the previous bullet.
			items[items.length - 1] += ` ${line}`;
		} else {
			if (items.length > 0) flush();
			paragraph.push(line);
		}
	}
	flush();
	return blocks;
}

/** The thoughts in `reasoning`, in order. Empty text gives no thoughts. */
export function parseReasoning(reasoning: string): Thought[] {
	const blocks = reasoning
		.replace(/\r\n?/g, "\n")
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block !== "");

	const thoughts: Thought[] = [];
	for (const block of blocks) {
		const title = titleOf(block);
		if (title !== null) {
			thoughts.push({ title, blocks: [] });
			continue;
		}
		let current = thoughts[thoughts.length - 1];
		if (!current) {
			current = { title: null, blocks: [] };
			thoughts.push(current);
		}
		current.blocks.push(...blocksOf(block));
	}
	return thoughts;
}

export type InlineToken =
	| { kind: "text"; text: string }
	| { kind: "strong"; text: string }
	| { kind: "code"; text: string };

/** Splits a line into plain text, `**bold**` and `code`; marks that do not pair up stay as written. */
export function splitInline(text: string): InlineToken[] {
	const tokens: InlineToken[] = [];
	const marks = /\*\*(.+?)\*\*|`([^`]+)`/g;
	let last = 0;
	for (const match of text.matchAll(marks)) {
		if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
		tokens.push(
			match[1] !== undefined ? { kind: "strong", text: match[1] } : { kind: "code", text: match[2] }
		);
		last = match.index + match[0].length;
	}
	if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
	return tokens;
}
