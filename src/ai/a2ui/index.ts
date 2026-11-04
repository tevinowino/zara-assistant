import { validateAgainstCatalog, type ValidSurface } from "./catalog";
import { buildSurfaces } from "./surface";

export { CATALOG, CATALOG_ID, buildSurfaceCatalogDoc } from "./catalog";
export type { CatalogComponentName, ValidComponent, ValidSurface } from "./catalog";

export interface ReadSurfaces {
	/** Surfaces that are structurally sound and use only catalog components. */
	surfaces: ValidSurface[];
	/** One sentence per thing that went wrong, fit to hand back to the model. */
	problems: string[];
}

/**
 * Reads the body of an `a2ui` fence (A2UI v0.9 messages, one per line) into
 * surfaces ready to draw. Never throws. Anything unusable is left out and
 * described in `problems`.
 */
export function readSurfaces(jsonl: string): ReadSurfaces {
	const built = buildSurfaces(jsonl);
	const problems = [...built.problems];
	const surfaces: ValidSurface[] = [];
	for (const surface of built.surfaces) {
		const result = validateAgainstCatalog(surface);
		if ("problem" in result) problems.push(result.problem);
		else surfaces.push(result.surface);
	}
	return { surfaces, problems };
}
