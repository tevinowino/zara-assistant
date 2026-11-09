import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import {
	parseClaudeUsagePreferences,
	useClaudeUsagePreferences
} from "./useClaudeUsagePreferences";

const savedValue = (key: string) =>
	invokeCalls
		.filter((call) => call.command === "save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === key)
		.map((args) => args.value)
		.at(-1);

const readFrom = (stored: Record<string, string>) => (key: string) => stored[key];

describe("parseClaudeUsagePreferences", () => {
	it("is off and has no budget when nothing was saved", () => {
		expect(parseClaudeUsagePreferences(readFrom({}))).toEqual({ allowed: false, budgetUsd: null });
	});

	it("reads what the user saved", () => {
		const preferences = parseClaudeUsagePreferences(
			readFrom({ "zara-claude-usage-enabled": "true", "zara-claude-usage-budget-usd": "50" })
		);

		expect(preferences).toEqual({ allowed: true, budgetUsd: 50 });
	});

	it("is off for anything but the word true", () => {
		expect(
			parseClaudeUsagePreferences(readFrom({ "zara-claude-usage-enabled": "yes" })).allowed
		).toBe(false);
	});

	it("has no budget for something that is not a sensible amount", () => {
		const budget = (value: string) =>
			parseClaudeUsagePreferences(readFrom({ "zara-claude-usage-budget-usd": value })).budgetUsd;

		expect(budget("")).toBeNull();
		expect(budget("lots")).toBeNull();
		expect(budget("-3")).toBeNull();
		expect(budget("0")).toBeNull();
		expect(budget("999999999")).toBeNull();
	});
});

describe("useClaudeUsagePreferences", () => {
	beforeEach(() => {
		localStorage.clear();
		setInvokeHandler("save_setting", () => undefined);
	});

	it("starts off, so nothing is read until the user allows it", () => {
		const { result } = renderHook(() => useClaudeUsagePreferences());

		expect(result.current.allowed).toBe(false);
	});

	it("allows counting and saves it", () => {
		const { result } = renderHook(() => useClaudeUsagePreferences());

		act(() => result.current.setAllowed(true));

		expect(result.current.allowed).toBe(true);
		expect(savedValue("zara-claude-usage-enabled")).toBe("true");
	});

	it("stops counting and saves it", () => {
		localStorage.setItem("zara-claude-usage-enabled", "true");
		const { result } = renderHook(() => useClaudeUsagePreferences());

		act(() => result.current.setAllowed(false));

		expect(result.current.allowed).toBe(false);
		expect(savedValue("zara-claude-usage-enabled")).toBe("false");
	});

	it("sets a budget and saves it", () => {
		const { result } = renderHook(() => useClaudeUsagePreferences());

		act(() => result.current.setBudgetUsd(75));

		expect(result.current.budgetUsd).toBe(75);
		expect(savedValue("zara-claude-usage-budget-usd")).toBe("75");
	});

	it("removes the budget", () => {
		localStorage.setItem("zara-claude-usage-budget-usd", "75");
		const { result } = renderHook(() => useClaudeUsagePreferences());

		act(() => result.current.setBudgetUsd(null));

		expect(result.current.budgetUsd).toBeNull();
		expect(savedValue("zara-claude-usage-budget-usd")).toBe("");
	});
});
