import { describe, expect, it } from "vitest";
import {
	ACCENT_HEX,
	ACCENT_NAMES,
	SERIES_ACCENT_ORDER,
	accentSchema,
	resolveColor
} from "./accent";

describe("resolveColor", () => {
	it("turns an accent name into its colour", () => {
		expect(resolveColor("green")).toBe(ACCENT_HEX.green);
		expect(resolveColor("purple")).toBe(ACCENT_HEX.purple);
	});

	it("passes a 6-digit hex colour through", () => {
		expect(resolveColor("#112233")).toBe("#112233");
	});

	it("gives nothing for anything it does not recognise", () => {
		expect(resolveColor("chartreuse")).toBeUndefined();
		expect(resolveColor("#123")).toBeUndefined();
		expect(resolveColor("url(javascript:alert(1))")).toBeUndefined();
		expect(resolveColor("")).toBeUndefined();
		expect(resolveColor(undefined)).toBeUndefined();
	});
});

describe("the accent palette", () => {
	it("has a valid 6-digit hex colour for every name", () => {
		for (const name of ACCENT_NAMES) {
			expect(ACCENT_HEX[name]).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("accepts exactly the names it has", () => {
		for (const name of ACCENT_NAMES) expect(accentSchema.safeParse(name).success).toBe(true);
		expect(accentSchema.safeParse("orange").success).toBe(false);
	});

	it("orders series colours so the first four are easy to tell apart", () => {
		expect(SERIES_ACCENT_ORDER.slice(0, 4)).toEqual(["blue", "green", "amber", "purple"]);
		expect(new Set(SERIES_ACCENT_ORDER).size).toBe(ACCENT_NAMES.length);
	});
});
