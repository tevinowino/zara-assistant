import { describe, expect, it } from "vitest";
import { getAtPointer, resolveDynamic, setAtPointer } from "./binding";

describe("getAtPointer", () => {
	it("reads nested object keys and array items", () => {
		const model = { order: { id: "A-1", lines: [{ sku: "x" }, { sku: "y" }] } };

		expect(getAtPointer(model, "/order/id")).toBe("A-1");
		expect(getAtPointer(model, "/order/lines/1/sku")).toBe("y");
	});

	it("treats / as the whole model", () => {
		expect(getAtPointer({ a: 1 }, "/")).toEqual({ a: 1 });
	});

	it("returns undefined for a path that does not exist", () => {
		expect(getAtPointer({ a: { b: 1 } }, "/a/c/d")).toBeUndefined();
		expect(getAtPointer({ a: [1] }, "/a/5")).toBeUndefined();
	});

	it("decodes ~1 as / and ~0 as ~ in keys", () => {
		expect(getAtPointer({ "a/b": 1, "c~d": 2 }, "/a~1b")).toBe(1);
		expect(getAtPointer({ "a/b": 1, "c~d": 2 }, "/c~0d")).toBe(2);
	});

	it("never reads inherited properties", () => {
		expect(getAtPointer({}, "/__proto__")).toBeUndefined();
		expect(getAtPointer({}, "/constructor")).toBeUndefined();
	});
});

describe("setAtPointer", () => {
	it("sets a value without changing the original model", () => {
		const original = { user: { name: "Ada" } };

		const updated = setAtPointer(original, "/user/name", "Grace");

		expect(updated).toEqual({ user: { name: "Grace" } });
		expect(original).toEqual({ user: { name: "Ada" } });
	});

	it("creates missing objects along the path", () => {
		expect(setAtPointer({}, "/a/b/c", 1)).toEqual({ a: { b: { c: 1 } } });
	});

	it("creates an array when the next step is an index", () => {
		expect(setAtPointer({}, "/items/0", "first")).toEqual({ items: ["first"] });
	});

	it("removes the key when the value is undefined", () => {
		expect(setAtPointer({ a: 1, b: 2 }, "/a", undefined)).toEqual({ b: 2 });
	});

	it("replaces the whole model when the path is /", () => {
		expect(setAtPointer({ a: 1 }, "/", { b: 2 })).toEqual({ b: 2 });
	});

	it("refuses keys that could pollute object prototypes", () => {
		const result = setAtPointer({}, "/__proto__/polluted", true);

		expect(result).toEqual({});
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("refuses an array index so large it would allocate a huge array", () => {
		expect(setAtPointer({}, "/items/999999999", "x")).toEqual({});
	});
});

describe("resolveDynamic", () => {
	const model = { user: { first: "Ada", last: "Lovelace" }, count: 3 };

	it("returns a literal unchanged", () => {
		expect(resolveDynamic("hello", { model })).toBe("hello");
		expect(resolveDynamic(42, { model })).toBe(42);
	});

	it("reads an absolute path from the data model", () => {
		expect(resolveDynamic({ path: "/user/first" }, { model })).toBe("Ada");
	});

	it("reads a relative path against the current list item", () => {
		const listModel = { people: [{ name: "Ada" }, { name: "Grace" }] };

		expect(resolveDynamic({ path: "name" }, { model: listModel, itemPath: "/people/1" })).toBe(
			"Grace"
		);
	});

	it("still reaches the root with an absolute path inside a list item", () => {
		const listModel = { title: "Team", people: [{ name: "Ada" }] };

		expect(resolveDynamic({ path: "/title" }, { model: listModel, itemPath: "/people/0" })).toBe(
			"Team"
		);
	});

	it("gives undefined for a relative path outside any list item", () => {
		expect(resolveDynamic({ path: "name" }, { model })).toBeUndefined();
	});

	it("fills formatString placeholders from the data model", () => {
		const value = {
			call: "formatString",
			args: {
				value: "Hello ${/user/first} ${/user/last}, you have ${/count} items"
			}
		};

		expect(resolveDynamic(value, { model })).toBe("Hello Ada Lovelace, you have 3 items");
	});

	it("leaves a placeholder empty when its path is missing", () => {
		const value = {
			call: "formatString",
			args: { value: "Hi ${/user/nickname}!" }
		};

		expect(resolveDynamic(value, { model })).toBe("Hi !");
	});

	it("writes a literal ${ for the escaped form", () => {
		const value = {
			call: "formatString",
			args: { value: "cost is \\${/count}" }
		};

		expect(resolveDynamic(value, { model })).toBe("cost is ${/count}");
	});

	it("resolves nested bindings inside function arguments", () => {
		const value = {
			call: "formatString",
			args: { value: { path: "/user/first" } }
		};

		expect(resolveDynamic(value, { model })).toBe("Ada");
	});

	it("gives undefined for a function the catalog does not define", () => {
		expect(resolveDynamic({ call: "runShell", args: { cmd: "dir" } }, { model })).toBeUndefined();
	});
});
