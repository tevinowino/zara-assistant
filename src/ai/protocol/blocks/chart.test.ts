import { describe, it, expect } from "vitest";
import { chart } from "./chart";

describe("chart block schema", () => {
	it("rejects a NaN value — Recharts throws mid-render on a non-finite domain", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			data: [{ x: "Jul", revenue: NaN }],
			series: ["revenue"]
		});

		expect(result.success).toBe(false);
	});

	it("rejects a payload over the 30-point cap", () => {
		const data = Array.from({ length: 31 }, (_, i) => ({ x: i, revenue: i }));
		const result = chart.schema.safeParse({ kind: "line", data, series: ["revenue"] });

		expect(result.success).toBe(false);
	});

	it("rejects more than 4 series", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			data: [{ x: "Jul", a: 1, b: 2, c: 3, d: 4, e: 5 }],
			series: ["a", "b", "c", "d", "e"]
		});

		expect(result.success).toBe(false);
	});

	it("accepts a well-formed multi-series line chart", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			title: "Revenue vs Cost",
			data: [
				{ x: "Jul", revenue: 12, cost: 8 },
				{ x: "Aug", revenue: 19, cost: 9 }
			],
			series: ["revenue", "cost"]
		});

		expect(result.success).toBe(true);
	});

	it("accepts a colors array with exactly one entry per series", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			data: [{ x: "Jul", revenue: 12, cost: 8 }],
			series: ["revenue", "cost"],
			colors: ["#60a5fa", "#f472b6"]
		});

		expect(result.success).toBe(true);
	});

	it("accepts accent names as chart colors", () => {
		const result = chart.schema.safeParse({
			kind: "bar",
			data: [{ x: "a", cost: 1, revenue: 2 }],
			series: ["cost", "revenue"],
			colors: ["red", "green"]
		});

		expect(result.success).toBe(true);
	});

	it("rejects a colors array whose length doesn't match series", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			data: [{ x: "Jul", revenue: 12, cost: 8 }],
			series: ["revenue", "cost"],
			colors: ["#60a5fa"]
		});

		expect(result.success).toBe(false);
	});

	it("rejects a malformed hex color", () => {
		const result = chart.schema.safeParse({
			kind: "line",
			data: [{ x: "Jul", revenue: 12 }],
			series: ["revenue"],
			colors: ["not-a-color"]
		});

		expect(result.success).toBe(false);
	});
});
