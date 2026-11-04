import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBlockCatalog } from "./catalog";

describe("the block catalog the Rust backend shows the model", () => {
	it("is identical to the copy embedded in src-tauri, so the model never reads about a block the UI cannot draw", () => {
		const embeddedInRust = readFileSync(
			resolve(process.cwd(), "src-tauri/src/ai/block_catalog.txt"),
			"utf8"
		);

		expect(embeddedInRust).toBe(buildBlockCatalog());
	});
});
