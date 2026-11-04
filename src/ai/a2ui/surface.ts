// Turns a reply's A2UI messages into finished surfaces: a flat component list
// and a data model, checked for the structural mistakes that would make a
// renderer loop or crash (no root, dangling child, cycle, runaway depth).
//
// A reply arrives whole, so every check runs once, on the final result. The
// order of messages still matters only as the protocol says: a surface is
// created before it is updated, but components may name children defined in a
// later message.

import { isWritablePointer, setAtPointer, type Json } from "./binding";
import { parseEnvelopes, type SurfaceComponent } from "./envelope";

export const MAX_SURFACES = 2;
export const MAX_COMPONENTS = 40;
export const MAX_DEPTH = 5;

export interface Surface {
	id: string;
	catalogId: string;
	/** Components by id; the one with id "root" is where drawing starts. */
	components: Record<string, SurfaceComponent>;
	dataModel: Json;
}

export interface SurfaceBuild {
	/** Only surfaces that passed every structural check. */
	surfaces: Surface[];
	/** One sentence per thing that went wrong, fit to hand back to the model. */
	problems: string[];
}

/** Ids of the components a component draws inside itself. */
export function childIdsOf(component: SurfaceComponent): string[] {
	const ids: string[] = [];
	const { child, children } = component as {
		child?: unknown;
		children?: unknown;
	};
	if (typeof child === "string") ids.push(child);
	if (Array.isArray(children)) {
		for (const entry of children) if (typeof entry === "string") ids.push(entry);
	} else if (children !== null && typeof children === "object") {
		const template = (children as { componentId?: unknown }).componentId;
		if (typeof template === "string") ids.push(template);
	}
	return ids;
}

/** What is wrong with the tree under `root`, or null if it is sound. */
function findStructuralProblem(surface: Surface): string | null {
	if (!surface.components.root) return `surface "${surface.id}" has no component with id "root"`;

	const visit = (id: string, path: string[]): string | null => {
		const component = surface.components[id];
		if (!component)
			return `surface "${surface.id}": "${path.at(-1)}" refers to missing component "${id}"`;
		if (path.includes(id)) return `surface "${surface.id}": component "${id}" contains itself`;
		if (path.length >= MAX_DEPTH)
			return `surface "${surface.id}" is nested deeper than ${MAX_DEPTH} levels`;
		for (const childId of childIdsOf(component)) {
			const problem = visit(childId, [...path, id]);
			if (problem) return problem;
		}
		return null;
	};
	return visit("root", []);
}

/**
 * Builds surfaces from a JSONL body of A2UI messages. Never throws: whatever
 * could not be used is described in `problems`.
 */
export function buildSurfaces(jsonl: string): SurfaceBuild {
	const { envelopes, problems } = parseEnvelopes(jsonl);
	const surfaces = new Map<string, Surface>();

	for (const envelope of envelopes) {
		if ("createSurface" in envelope) {
			const { surfaceId, catalogId } = envelope.createSurface;
			if (surfaces.has(surfaceId)) problems.push(`surface "${surfaceId}" was created twice`);
			else if (surfaces.size >= MAX_SURFACES) problems.push(`more than ${MAX_SURFACES} surfaces`);
			else
				surfaces.set(surfaceId, {
					id: surfaceId,
					catalogId,
					components: {},
					dataModel: {}
				});
		} else if ("updateComponents" in envelope) {
			const { surfaceId, components } = envelope.updateComponents;
			const surface = surfaces.get(surfaceId);
			if (!surface) {
				problems.push(`updateComponents names unknown surface "${surfaceId}"`);
				continue;
			}
			for (const component of components) {
				const isNew = !(component.id in surface.components);
				if (isNew && Object.keys(surface.components).length >= MAX_COMPONENTS) {
					problems.push(`surface "${surfaceId}" has more than ${MAX_COMPONENTS} components`);
					break;
				}
				surface.components[component.id] = component;
			}
		} else if ("updateDataModel" in envelope) {
			const { surfaceId, path = "/", value } = envelope.updateDataModel;
			const surface = surfaces.get(surfaceId);
			if (!surface) {
				problems.push(`updateDataModel names unknown surface "${surfaceId}"`);
			} else if (!isWritablePointer(path)) {
				problems.push(`updateDataModel path "${path}" is not allowed`);
			} else {
				surface.dataModel = setAtPointer(surface.dataModel, path, value as Json | undefined);
			}
		} else {
			surfaces.delete(envelope.deleteSurface.surfaceId);
		}
	}

	const finished: Surface[] = [];
	for (const surface of surfaces.values()) {
		const problem = findStructuralProblem(surface);
		if (problem) problems.push(problem);
		else finished.push(surface);
	}
	return { surfaces: finished, problems };
}
