import { describe, expect, it } from "vitest";
import { SURFACE_EXAMPLE } from "../a2ui/catalog";
import { parseMessageContent } from "./parse";

describe("parseMessageContent with a2ui fences", () => {
	it("turns an a2ui fence into a surface segment between two prose segments", () => {
		const raw = `Here is a plan.\n\n\`\`\`a2ui\n${SURFACE_EXAMPLE}\n\`\`\`\n\nWant changes?`;

		const segments = parseMessageContent(raw);

		expect(segments.map((segment) => segment.kind)).toEqual(["markdown", "surface", "markdown"]);
		const surface = segments[1];
		expect(surface.kind === "surface" && surface.surfaces).toHaveLength(1);
	});

	it("shows a fallback with the first problem when the fence has no usable surface", () => {
		const raw = '```a2ui\n{"version":"v0.9","deleteSurface":{"surfaceId":"nothing"}}\n```';

		const segments = parseMessageContent(raw);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			kind: "block-error",
			type: "a2ui",
			reason: "invalid-surface",
			detail: "The surface was empty."
		});
	});

	it("explains why a surface was rejected", () => {
		const bad = [
			'{"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"zara:notch/v1"}}',
			'{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Video"}]}}'
		].join("\n");

		const segments = parseMessageContent("```a2ui\n" + bad + "\n```");

		expect(segments[0]).toMatchObject({
			kind: "block-error",
			detail: 'component "root" has unknown type "Video"'
		});
	});

	it("shows a loading placeholder while the fence is still arriving", () => {
		const segments = parseMessageContent('```a2ui\n{"version":"v0.9"', {
			streaming: true
		});

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({ kind: "block-pending", type: "a2ui" });
	});

	it("still parses zara blocks written the old way next to a surface", () => {
		const stat = '```zara:stat\n{"items":[{"label":"Revenue","value":"$482K"}]}\n```';
		const raw = `${stat}\n\n\`\`\`a2ui\n${SURFACE_EXAMPLE}\n\`\`\``;

		const segments = parseMessageContent(raw);

		expect(segments.map((segment) => segment.kind)).toEqual(["block", "surface"]);
	});
});
