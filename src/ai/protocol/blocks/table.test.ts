import { describe, it, expect } from "vitest";
import { table } from "./table";

describe("table block schema", () => {
	it("rejects a row whose cell count doesn't match the column count", () => {
		const result = table.schema.safeParse({
			columns: ["Model", "Price"],
			rows: [["A", "$10", "extra cell"]]
		});

		expect(result.success).toBe(false);
	});

	it("rejects more than 12 rows", () => {
		const rows = Array.from({ length: 13 }, (_, i) => [`row ${i}`]);
		const result = table.schema.safeParse({ columns: ["Name"], rows });

		expect(result.success).toBe(false);
	});

	it("accepts a well-formed table", () => {
		const result = table.schema.safeParse({
			columns: ["Model", "Price"],
			rows: [
				["A", "$10"],
				["B", 8]
			]
		});

		expect(result.success).toBe(true);
	});

	it("computes height from row count, capped at 240", () => {
		const heightFn = table.height as (data: { columns: string[]; rows: unknown[][] }) => number;
		expect(heightFn({ columns: ["x"], rows: [["a"]] })).toBe(44 + 32);
		expect(heightFn({ columns: ["x"], rows: Array.from({ length: 12 }, () => ["a"]) })).toBe(240);
	});
});
