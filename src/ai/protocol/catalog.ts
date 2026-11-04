import { BLOCK_CONTRACTS } from "./index";

// The documentation the model reads about each widget, derived from
// BLOCK_CONTRACTS rather than hand-maintained, so the catalog can never omit a
// registered block.
//
// The Rust backend builds the full system prompt (src-tauri/src/ai/protocol.rs)
// and embeds this text from src-tauri/src/ai/block_catalog.txt. The drift test in
// catalog.test.ts fails if that file stops matching this function, and the file
// is regenerated from it.
export function buildBlockCatalog(): string {
	return Object.values(BLOCK_CONTRACTS)
		.map(
			(contract) =>
				`### ${contract.type}\n${contract.doc.summary}\n` +
				`USE WHEN: ${contract.doc.whenToUse}\n` +
				`DO NOT USE WHEN: ${contract.doc.whenNotToUse}\n` +
				`${contract.doc.example}`
		)
		.join("\n\n");
}
