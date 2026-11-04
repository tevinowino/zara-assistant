import { describe, it, expect } from "vitest";
import { parseMessageContent } from "./parse";

const STAT_BODY = '{"items":[{"label":"Revenue","value":"$482K"}]}';
const STAT_FENCE = "```zara:stat\n" + STAT_BODY + "\n```";

describe("parseMessageContent", () => {
	it("parses a single markdown-only message as one segment", () => {
		const segments = parseMessageContent("Just plain prose, no blocks.");

		expect(segments).toEqual([
			{ kind: "markdown", index: 0, text: "Just plain prose, no blocks." }
		]);
	});

	it("parses a valid block with no surrounding prose", () => {
		const segments = parseMessageContent(STAT_FENCE);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			kind: "block",
			type: "stat",
			data: { items: [{ label: "Revenue", value: "$482K" }] }
		});
	});

	it("parses a block immediately adjacent to prose with no blank line separator", () => {
		const raw = `Revenue climbed steadily.\n${STAT_FENCE}\nThat's the summary.`;
		const segments = parseMessageContent(raw);

		expect(segments.map((s) => s.kind)).toEqual(["markdown", "block", "markdown"]);
		expect((segments[0] as any).text).toBe("Revenue climbed steadily.");
		expect((segments[2] as any).text).toBe("That's the summary.");
	});

	it("parses two consecutive blocks with no prose between them", () => {
		const raw = `${STAT_FENCE}\n${STAT_FENCE}`;
		const segments = parseMessageContent(raw);

		expect(segments.map((s) => s.kind)).toEqual(["block", "block"]);
	});

	it("reports unknown-type for an unregistered block type", () => {
		const raw = '```zara:sankey\n{"foo":"bar"}\n```';
		const segments = parseMessageContent(raw);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			kind: "block-error",
			type: "sankey",
			reason: "unknown-type"
		});
	});

	it("reports invalid-json for a body that doesn't parse as JSON", () => {
		const raw = "```zara:stat\n{not valid json\n```";
		const segments = parseMessageContent(raw);

		expect(segments[0]).toMatchObject({
			kind: "block-error",
			type: "stat",
			reason: "invalid-json"
		});
	});

	it("reports schema-mismatch for JSON that doesn't satisfy the block's schema", () => {
		const raw = '```zara:stat\n{"items":[]}\n```'; // items requires min(1)
		const segments = parseMessageContent(raw);

		expect(segments[0]).toMatchObject({
			kind: "block-error",
			type: "stat",
			reason: "schema-mismatch"
		});
		expect((segments[0] as any).detail).toContain("items");
	});

	it("reports block-pending for an unterminated fence while streaming", () => {
		const raw = `${"```zara:stat\n" + STAT_BODY}`; // no closing fence
		const segments = parseMessageContent(raw, { streaming: true });

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({ kind: "block-pending", type: "stat" });
	});

	it("reports unterminated (not pending) for the same unclosed fence once streaming is complete", () => {
		const raw = "```zara:stat\n" + STAT_BODY;
		const segments = parseMessageContent(raw, { streaming: false });

		expect(segments[0]).toMatchObject({
			kind: "block-error",
			type: "stat",
			reason: "unterminated"
		});
	});

	it("does not false-close on a fence-like line inside a JSON string value", () => {
		// JSON cannot contain a raw newline inside a string, so a ``` run can
		// never be the first thing on a physical body line — this body line
		// starts with `{`, not backticks, so it can't be mistaken for a fence.
		const raw = '```zara:stat\n{"items":[{"label":"has ``` inside","value":"1"}]}\n```';
		const segments = parseMessageContent(raw);

		expect(segments[0].kind).toBe("block");
		expect((segments[0] as any).data.items[0].label).toBe("has ``` inside");
	});

	it("passes a non-zara fence through untouched inside the surrounding markdown segment", () => {
		const raw = "before\n```js\nconst x = 1;\n```\nafter";
		const segments = parseMessageContent(raw);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({
			kind: "markdown",
			index: 0,
			text: "before\n```js\nconst x = 1;\n```\nafter"
		});
	});

	it("does not let a nested 3-backtick zara fence close a 4-backtick outer fence", () => {
		const raw = "````\nExample of the syntax:\n```zara:stat\n{}\n```\n````";
		const segments = parseMessageContent(raw);

		// The outer fence has no "zara:" info string, so the whole thing —
		// including the inner ```zara:stat text — passes through as one
		// markdown segment, exactly as CommonMark's non-nesting fence rule says.
		expect(segments).toHaveLength(1);
		expect(segments[0].kind).toBe("markdown");
		expect((segments[0] as any).text).toContain("```zara:stat");
	});

	it("recognizes ~~~ as a valid fence character, not just backticks", () => {
		const raw = "~~~zara:stat\n" + STAT_BODY + "\n~~~";
		const segments = parseMessageContent(raw);

		expect(segments[0].kind).toBe("block");
	});

	it("drops whitespace-only markdown segments between adjacent blocks", () => {
		const raw = `${STAT_FENCE}\n\n   \n${STAT_FENCE}`;
		const segments = parseMessageContent(raw);

		expect(segments.map((s) => s.kind)).toEqual(["block", "block"]);
	});

	it("produces stable index values across repeated calls with identical input", () => {
		const raw = `intro\n${STAT_FENCE}\noutro`;
		const first = parseMessageContent(raw);
		const second = parseMessageContent(raw);

		expect(first.map((s) => s.index)).toEqual(second.map((s) => s.index));
		expect(first.map((s) => s.kind)).toEqual(second.map((s) => s.kind));
	});
});
