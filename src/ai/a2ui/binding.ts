// Data binding for A2UI surfaces: reading and writing the surface's data model
// by JSON Pointer, and resolving a component property that may be a literal, a
// `{path}` reference, or a `{call}` of a catalog function.
//
// Everything here is pure. The data model arrives from a language model, so
// writes are defensive: keys that could pollute prototypes are refused, and so
// are array indexes large enough to allocate a huge array.

import { callFunction } from "./functions";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const MAX_POINTER_DEPTH = 8;
const MAX_ARRAY_INDEX = 999;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** The steps of a pointer, or null if it is malformed or unsafe. "/" is the root. */
function parsePointer(pointer: string): string[] | null {
	if (pointer === "" || pointer === "/") return [];
	if (!pointer.startsWith("/")) return null;
	const steps = pointer
		.slice(1)
		.split("/")
		.map((step) => step.replace(/~1/g, "/").replace(/~0/g, "~"));
	if (steps.length > MAX_POINTER_DEPTH) return null;
	if (steps.some((step) => FORBIDDEN_KEYS.has(step))) return null;
	return steps;
}

function isIndex(step: string): boolean {
	return /^\d+$/.test(step);
}

function readStep(container: unknown, step: string): unknown {
	if (Array.isArray(container)) return isIndex(step) ? container[Number(step)] : undefined;
	if (container !== null && typeof container === "object") {
		return Object.prototype.hasOwnProperty.call(container, step)
			? (container as Record<string, unknown>)[step]
			: undefined;
	}
	return undefined;
}

/** The value at `pointer`, or undefined if the path does not exist. */
export function getAtPointer(model: unknown, pointer: string): unknown {
	const steps = parsePointer(pointer);
	if (steps === null) return undefined;
	let current: unknown = model;
	for (const step of steps) {
		current = readStep(current, step);
		if (current === undefined) return undefined;
	}
	return current;
}

function writeStep(container: unknown, steps: string[], value: Json | undefined): Json | undefined {
	if (steps.length === 0) return value;
	const [step, ...rest] = steps;
	const wantsArray = isIndex(step);
	const base = Array.isArray(container)
		? [...container]
		: container !== null && typeof container === "object" && !wantsArray
			? { ...(container as Record<string, Json>) }
			: wantsArray
				? []
				: {};

	const child = writeStep(readStep(container, step), rest, value);
	if (Array.isArray(base)) {
		if (child === undefined) base.splice(Number(step), 1);
		else base[Number(step)] = child;
		return base;
	}
	if (child === undefined) delete base[step];
	else base[step] = child;
	return base;
}

/** Whether `setAtPointer` would accept this pointer rather than ignore it. */
export function isWritablePointer(pointer: string): boolean {
	const steps = parsePointer(pointer);
	return steps !== null && !steps.some((step) => isIndex(step) && Number(step) > MAX_ARRAY_INDEX);
}

/**
 * A copy of `model` with `value` at `pointer`; a value of undefined removes the
 * key. The original is never changed. An unsafe pointer leaves the model as is.
 */
export function setAtPointer(model: Json, pointer: string, value: Json | undefined): Json {
	if (!isWritablePointer(pointer)) return model;
	return writeStep(model, parsePointer(pointer) ?? [], value) ?? {};
}

export interface BindingScope {
	model: Json;
	/** Pointer to the current item when resolving inside a list template. */
	itemPath?: string;
}

function pathInScope(path: string, scope: BindingScope): string | null {
	if (path.startsWith("/")) return path;
	return scope.itemPath === undefined ? null : `${scope.itemPath}/${path}`;
}

function readPath(path: string, scope: BindingScope): unknown {
	const absolute = pathInScope(path, scope);
	return absolute === null ? undefined : getAtPointer(scope.model, absolute);
}

function displayText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

// Matches an escaped \${ (written literally) or a ${/path} placeholder.
const PLACEHOLDER = /\\\$\{|\$\{([^}]*)\}/g;

function interpolate(template: string, scope: BindingScope): string {
	return template.replace(PLACEHOLDER, (_match, expression: string | undefined) =>
		expression === undefined ? "${" : displayText(readPath(expression.trim(), scope))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolves a component property: a literal is returned as is, `{path}` reads
 * the data model, and `{call, args}` runs a catalog function on resolved
 * arguments. Missing data and unknown functions give undefined, which the
 * renderer shows as empty.
 */
export function resolveDynamic(value: unknown, scope: BindingScope): unknown {
	if (!isRecord(value)) return value;
	if (typeof value.path === "string") return readPath(value.path, scope);
	if (typeof value.call !== "string") return value;

	const rawArgs = isRecord(value.args) ? value.args : {};
	const args = Object.fromEntries(
		Object.entries(rawArgs).map(([name, arg]) => [name, resolveDynamic(arg, scope)])
	);
	if (value.call === "formatString") {
		return typeof args.value === "string" ? interpolate(args.value, scope) : "";
	}
	return callFunction(value.call, args);
}
