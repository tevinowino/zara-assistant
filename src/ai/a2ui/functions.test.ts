import { describe, expect, it } from "vitest";
import { callFunction } from "./functions";

describe("callFunction", () => {
	it("formats a number with a fixed number of decimals", () => {
		expect(callFunction("formatNumber", { value: 1234.5, decimals: 2 })).toBe("1,234.50");
	});

	it("picks the singular or plural word for a count", () => {
		const words = { one: "item", other: "items" };

		expect(callFunction("pluralize", { value: 1, ...words })).toBe("item");
		expect(callFunction("pluralize", { value: 3, ...words })).toBe("items");
	});

	it("uses the zero form when one is given", () => {
		expect(
			callFunction("pluralize", {
				value: 0,
				zero: "no items",
				one: "item",
				other: "items"
			})
		).toBe("no items");
	});

	it("reports whether a value is present", () => {
		expect(callFunction("required", { value: "x" })).toBe(true);
		expect(callFunction("required", { value: "   " })).toBe(false);
		expect(callFunction("required", { value: undefined })).toBe(false);
		expect(callFunction("required", { value: "" })).toBe(false);
	});

	it("checks string length limits", () => {
		expect(callFunction("length", { value: "abc", min: 2, max: 4 })).toBe(true);
		expect(callFunction("length", { value: "a", min: 2 })).toBe(false);
		expect(callFunction("length", { value: "abcde", max: 4 })).toBe(false);
	});

	it("checks that a value is a number inside a range", () => {
		expect(callFunction("numeric", { value: "12", min: 1, max: 50 })).toBe(true);
		expect(callFunction("numeric", { value: "abc" })).toBe(false);
		expect(callFunction("numeric", { value: 99, max: 50 })).toBe(false);
	});

	it("checks an email address shape", () => {
		expect(callFunction("email", { value: "ada@example.com" })).toBe(true);
		expect(callFunction("email", { value: "not an email" })).toBe(false);
	});

	it("combines booleans with and, or and not", () => {
		expect(callFunction("and", { values: [true, true] })).toBe(true);
		expect(callFunction("and", { values: [true, false] })).toBe(false);
		expect(callFunction("or", { values: [false, true] })).toBe(true);
		expect(callFunction("not", { value: true })).toBe(false);
	});

	it("returns undefined for an unknown function", () => {
		expect(callFunction("openUrl", { url: "https://example.com" })).toBeUndefined();
	});
});
