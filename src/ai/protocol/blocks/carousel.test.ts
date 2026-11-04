import { describe, it, expect } from "vitest";
import { carousel } from "./carousel";

describe("carousel block schema", () => {
	it("rejects fewer than 2 items", () => {
		const result = carousel.schema.safeParse({ items: [{ title: "Only one" }] });
		expect(result.success).toBe(false);
	});

	it("rejects more than 6 items", () => {
		const items = Array.from({ length: 7 }, (_, i) => ({ title: `Item ${i}` }));
		const result = carousel.schema.safeParse({ items });
		expect(result.success).toBe(false);
	});

	it("accepts items without a description", () => {
		const result = carousel.schema.safeParse({ items: [{ title: "Starter" }, { title: "Pro" }] });
		expect(result.success).toBe(true);
	});

	it("accepts an item with a valid hex color", () => {
		const result = carousel.schema.safeParse({
			items: [{ title: "Starter", color: "#60a5fa" }, { title: "Pro" }]
		});
		expect(result.success).toBe(true);
	});

	it("rejects an item with a malformed color", () => {
		const result = carousel.schema.safeParse({
			items: [{ title: "Starter", color: "bluish" }, { title: "Pro" }]
		});
		expect(result.success).toBe(false);
	});

	it("rejects an item whose hex color is too short", () => {
		const result = carousel.schema.safeParse({
			items: [{ title: "Starter", color: "#12345" }, { title: "Pro" }]
		});
		expect(result.success).toBe(false);
	});

	it("accepts an accent name as an item color", () => {
		const result = carousel.schema.safeParse({
			items: [
				{ title: "Starter", color: "blue" },
				{ title: "Pro", color: "#a855f7" }
			]
		});
		expect(result.success).toBe(true);
	});
});
