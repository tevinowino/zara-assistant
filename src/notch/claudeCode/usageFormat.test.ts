import { describe, expect, it } from "vitest";
import {
	budgetState,
	formatHour,
	formatHourRange,
	formatTokens,
	formatUsd,
	parseBudget
} from "./usageFormat";

describe("formatTokens", () => {
	it("shows small counts as they are", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(57)).toBe("57");
		expect(formatTokens(999)).toBe("999");
	});

	it("shows thousands as K", () => {
		expect(formatTokens(1_000)).toBe("1K");
		expect(formatTokens(12_345)).toBe("12K");
		expect(formatTokens(853_000)).toBe("853K");
	});

	it("shows millions as M with one decimal, dropping a trailing zero", () => {
		expect(formatTokens(1_900_000)).toBe("1.9M");
		expect(formatTokens(1_000_000)).toBe("1M");
		expect(formatTokens(12_400_000)).toBe("12.4M");
	});

	it("rolls a count that rounds up to a thousand K over to M", () => {
		expect(formatTokens(999_700)).toBe("1M");
	});

	it("shows billions as B", () => {
		expect(formatTokens(2_500_000_000)).toBe("2.5B");
	});
});

describe("formatUsd", () => {
	it("shows dollars and cents", () => {
		expect(formatUsd(11.994)).toBe("$11.99");
		expect(formatUsd(0.48)).toBe("$0.48");
	});

	it("shows zero as $0.00", () => {
		expect(formatUsd(0)).toBe("$0.00");
	});

	it("groups thousands", () => {
		expect(formatUsd(1234.5)).toBe("$1,234.50");
	});

	it("says so when an amount is under a cent", () => {
		expect(formatUsd(0.004)).toBe("<$0.01");
	});
});

describe("formatHour and formatHourRange", () => {
	it("pads an hour to two digits", () => {
		expect(formatHour(7)).toBe("07:00");
		expect(formatHour(20)).toBe("20:00");
	});

	it("shows the two hours from a start", () => {
		expect(formatHourRange(20)).toBe("20:00 – 22:00");
	});

	it("wraps past midnight", () => {
		expect(formatHourRange(23)).toBe("23:00 – 01:00");
	});
});

describe("parseBudget", () => {
	it("reads a plain amount", () => {
		expect(parseBudget("50")).toBe(50);
		expect(parseBudget("49.5")).toBe(49.5);
	});

	it("allows a dollar sign, commas and spaces", () => {
		expect(parseBudget(" $1,200.00 ")).toBe(1200);
	});

	it("rounds to cents", () => {
		expect(parseBudget("10.456")).toBe(10.46);
	});

	it("is null for something that is not a positive amount", () => {
		expect(parseBudget("")).toBeNull();
		expect(parseBudget("lots")).toBeNull();
		expect(parseBudget("0")).toBeNull();
		expect(parseBudget("-5")).toBeNull();
	});

	it("is null for an absurd amount", () => {
		expect(parseBudget("99999999")).toBeNull();
	});
});

describe("budgetState", () => {
	it("is under until 80% of the budget", () => {
		expect(budgetState(7.9, 10)).toBe("under");
	});

	it("is close from 80% of the budget", () => {
		expect(budgetState(8, 10)).toBe("close");
		expect(budgetState(9.99, 10)).toBe("close");
	});

	it("is over from the whole budget", () => {
		expect(budgetState(10, 10)).toBe("over");
		expect(budgetState(25, 10)).toBe("over");
	});
});
