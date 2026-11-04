import { describe, it, expect } from "vitest";
import { BLOCK_CONTRACTS, ZARA_BLOCK_TYPES } from "./index";
import { buildBlockCatalog } from "./catalog";
import { parseMessageContent } from "./parse";

describe("block registry invariants", () => {
	it.each(ZARA_BLOCK_TYPES)(
		"%s's doc.example is a real fence that parses and validates against its own schema",
		(type) => {
			const contract = BLOCK_CONTRACTS[type];
			const segments = parseMessageContent(contract.doc.example);

			// Running the example through the real parser (not just JSON.parse) is
			// the guard that actually catches drift: if someone renames a schema
			// field and forgets the example, this fails with schema-mismatch.
			expect(segments).toHaveLength(1);
			expect(segments[0]).toMatchObject({ kind: "block", type });
		}
	);

	it("buildBlockCatalog documents every registered block type", () => {
		const catalog = buildBlockCatalog();

		for (const type of ZARA_BLOCK_TYPES) {
			expect(catalog).toContain(`### ${type}`);
			expect(catalog).toContain(BLOCK_CONTRACTS[type].doc.summary);
		}
	});

	it("buildBlockCatalog includes the restraint-relevant whenNotToUse line for every block", () => {
		const catalog = buildBlockCatalog();

		for (const type of ZARA_BLOCK_TYPES) {
			expect(catalog).toContain(BLOCK_CONTRACTS[type].doc.whenNotToUse);
		}
	});
});
