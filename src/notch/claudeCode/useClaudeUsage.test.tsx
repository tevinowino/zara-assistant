import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";
import type { UsageSummary } from "./usageTypes";
import { useClaudeUsage } from "./useClaudeUsage";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

const summaryWith = (tokens: number): UsageSummary => ({
	today: {
		tokens,
		costUsd: 1,
		messages: 1,
		toolCalls: 0,
		sessions: 1,
		topProject: null,
		streakDays: 0,
		hourlyTokens: Array(24).fill(0),
		peakStartHour: null,
		currentHour: 12
	},
	month: { costUsd: 1, tokens, byModel: [] },
	unpricedModels: [],
	anyUsage: true
});

async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

describe("useClaudeUsage", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("asks for nothing and says it is off until the user allows counting", async () => {
		setInvokeHandler("claude_usage_summary", () => summaryWith(1));

		const { result } = renderHook(() => useClaudeUsage(false));
		await flush();

		expect(result.current).toEqual({ status: "off" });
		expect(callsTo("claude_usage_summary")).toHaveLength(0);
	});

	it("says it is loading, then gives the numbers", async () => {
		setInvokeHandler("claude_usage_summary", () => summaryWith(500));

		const { result } = renderHook(() => useClaudeUsage(true));
		expect(result.current.status).toBe("loading");
		await flush();

		expect(result.current.status).toBe("ready");
		expect(result.current.status === "ready" && result.current.summary.today.tokens).toBe(500);
	});

	it("tells the backend the time and the user's offset from UTC", async () => {
		setInvokeHandler("claude_usage_summary", () => summaryWith(1));
		vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));

		renderHook(() => useClaudeUsage(true));
		await flush();

		const args = callsTo("claude_usage_summary")[0].args as {
			nowMs: number;
			utcOffsetMinutes: number;
		};
		expect(args.nowMs).toBe(Date.parse("2026-11-04T12:00:00Z"));
		expect(args.utcOffsetMinutes).toBe(-new Date().getTimezoneOffset());
	});

	it("says there was an error when the first reading fails", async () => {
		setInvokeHandler("claude_usage_summary", () => {
			throw new Error("not allowed");
		});

		const { result } = renderHook(() => useClaudeUsage(true));
		await flush();

		expect(result.current).toEqual({ status: "error" });
	});

	it("keeps showing the numbers it has when a later reading fails", async () => {
		let fail = false;
		setInvokeHandler("claude_usage_summary", () => {
			if (fail) throw new Error("hiccup");
			return summaryWith(500);
		});
		const { result } = renderHook(() => useClaudeUsage(true));
		await flush();

		fail = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(21_000);
		});

		expect(result.current.status).toBe("ready");
	});

	it("reads again every twenty seconds while open", async () => {
		let tokens = 100;
		setInvokeHandler("claude_usage_summary", () => summaryWith(tokens));
		const { result } = renderHook(() => useClaudeUsage(true));
		await flush();

		tokens = 900;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_500);
		});

		expect(result.current.status === "ready" && result.current.summary.today.tokens).toBe(900);
	});

	it("reads again soon after Claude Code reports activity, once for a burst", async () => {
		setInvokeHandler("claude_usage_summary", () => summaryWith(1));
		renderHook(() => useClaudeUsage(true));
		await flush();
		const before = callsTo("claude_usage_summary").length;

		await act(async () => {
			emitTauriEvent("claude-code-changed");
			emitTauriEvent("claude-code-changed");
			emitTauriEvent("claude-code-changed");
			await vi.advanceTimersByTimeAsync(2_000);
		});

		expect(callsTo("claude_usage_summary").length).toBe(before + 1);
	});

	it("stops reading and says it is off when the user turns counting off", async () => {
		setInvokeHandler("claude_usage_summary", () => summaryWith(1));
		const { result, rerender } = renderHook(({ allowed }) => useClaudeUsage(allowed), {
			initialProps: { allowed: true }
		});
		await flush();
		const before = callsTo("claude_usage_summary").length;

		rerender({ allowed: false });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});

		expect(result.current).toEqual({ status: "off" });
		expect(callsTo("claude_usage_summary").length).toBe(before);
	});
});
