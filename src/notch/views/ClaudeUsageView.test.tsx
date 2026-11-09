import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsageSummary } from "../claudeCode/usageTypes";
import type { ClaudeUsageState } from "../claudeCode/useClaudeUsage";
import { ClaudeUsageView, PLAN_USAGE_URL, type ClaudeUsageViewProps } from "./ClaudeUsageView";

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const hourlyTokens = Array.from({ length: 24 }, () => 0);
hourlyTokens[17] = 420_000;
hourlyTokens[20] = 600_000;

/** A day of heavy use: 1.9M tokens, 57 messages, $11.99 for the month over two models. */
const busyDay: UsageSummary = {
	today: {
		tokens: 1_900_000,
		costUsd: 1.26,
		messages: 57,
		toolCalls: 26,
		sessions: 2,
		topProject: "design-tokens",
		streakDays: 12,
		hourlyTokens,
		peakStartHour: 20,
		currentHour: 21
	},
	month: {
		costUsd: 11.99,
		tokens: 1_853_000,
		byModel: [
			{ model: "claude-sonnet-5-5", displayName: "Sonnet 5.5", tokens: 1_000_000, costUsd: 0.48 },
			{ model: "claude-opus-5-5", displayName: "Opus 5.5", tokens: 853_000, costUsd: 0.78 }
		]
	},
	unpricedModels: [],
	anyUsage: true
};

function renderView(overrides: Partial<ClaudeUsageViewProps> = {}) {
	const props: ClaudeUsageViewProps = {
		allowed: true,
		onAllow: vi.fn(),
		usage: { status: "ready", summary: busyDay },
		budgetUsd: null,
		onSetBudget: vi.fn(),
		...overrides
	};
	return { props, ...render(<ClaudeUsageView {...props} />) };
}

describe("ClaudeUsageView", () => {
	beforeEach(() => {
		openUrl.mockReset();
	});

	it("asks permission before counting anything", () => {
		renderView({ allowed: false, usage: { status: "off" } });

		expect(screen.getByText("See your Claude Code usage")).toBeInTheDocument();
		expect(screen.getByText(/never what was said/)).toBeInTheDocument();
		expect(screen.queryByText("Today")).not.toBeInTheDocument();
	});

	it("allows counting when the user agrees", async () => {
		const { props } = renderView({ allowed: false, usage: { status: "off" } });

		await userEvent.click(screen.getByRole("button", { name: "Allow" }));

		expect(props.onAllow).toHaveBeenCalledTimes(1);
	});

	it("says it is counting while the first numbers load", () => {
		renderView({ usage: { status: "loading" } });

		expect(screen.getByText(/Counting Claude Code's usage/)).toBeInTheDocument();
	});

	it("says when the usage could not be read", () => {
		renderView({ usage: { status: "error" } });

		expect(screen.getByText("Claude Code's usage could not be read.")).toBeInTheDocument();
	});

	it("says when there is no usage yet", () => {
		const nothing: ClaudeUsageState = {
			status: "ready",
			summary: { ...busyDay, anyUsage: false }
		};

		renderView({ usage: nothing });

		expect(screen.getByText(/No Claude Code usage found yet/)).toBeInTheDocument();
	});

	it("shows today's tokens and what they are worth at API prices", () => {
		renderView();
		const today = within(screen.getByRole("region", { name: "Today" }));

		expect(today.getByText("1.9M")).toBeInTheDocument();
		expect(today.getByText("≈ $1.26 API value today")).toBeInTheDocument();
	});

	it("shows today's messages, tool calls and sessions", () => {
		renderView();
		const today = within(screen.getByRole("region", { name: "Today" }));

		expect(today.getByText("57")).toBeInTheDocument();
		expect(today.getByText("Messages")).toBeInTheDocument();
		expect(today.getByText("26")).toBeInTheDocument();
		expect(today.getByText("Tool calls")).toBeInTheDocument();
		expect(today.getByText("2")).toBeInTheDocument();
		expect(today.getByText("Sessions")).toBeInTheDocument();
	});

	it("shows the busiest project and the streak", () => {
		renderView();

		expect(screen.getByText("design-tokens")).toBeInTheDocument();
		expect(screen.getByText("12-day streak")).toBeInTheDocument();
	});

	it("leaves out the streak when there is none", () => {
		const noStreak: ClaudeUsageState = {
			status: "ready",
			summary: { ...busyDay, today: { ...busyDay.today, streakDays: 0 } }
		};

		renderView({ usage: noStreak });

		expect(screen.queryByText(/-day streak/)).not.toBeInTheDocument();
		expect(screen.getByText("design-tokens")).toBeInTheDocument();
	});

	it("draws a bar for each of the 24 hours and names the busiest stretch", () => {
		renderView();
		const hours = screen.getByRole("region", { name: "Active hours" });

		expect(hours.querySelectorAll(".cu-bar")).toHaveLength(24);
		expect(hours.querySelectorAll(".cu-bar.used")).toHaveLength(2);
		expect(within(hours).getByText("Peak 20:00 – 22:00")).toBeInTheDocument();
	});

	it("marks the hour it is now", () => {
		renderView();

		expect(
			screen.getByRole("region", { name: "Active hours" }).querySelectorAll(".cu-bar.now")
		).toHaveLength(1);
	});

	it("names no peak on a day with no use", () => {
		const quiet: ClaudeUsageState = {
			status: "ready",
			summary: {
				...busyDay,
				today: { ...busyDay.today, peakStartHour: null, hourlyTokens: Array(24).fill(0) }
			}
		};

		renderView({ usage: quiet });

		expect(screen.queryByText(/^Peak/)).not.toBeInTheDocument();
	});

	it("shows this month's estimated cost", () => {
		renderView();
		const month = within(screen.getByRole("region", { name: "This month" }));

		expect(month.getByText("≈ $11.99")).toBeInTheDocument();
		expect(month.getByText(/Estimated at API prices/)).toBeInTheDocument();
	});

	it("opens the plan usage page in the browser", async () => {
		renderView();

		await userEvent.click(screen.getByRole("button", { name: /View plan usage/ }));

		expect(openUrl).toHaveBeenCalledWith(PLAN_USAGE_URL);
	});

	it("lists the month's models with their tokens and cost", () => {
		renderView();
		const models = within(screen.getByRole("region", { name: "By model" }));

		expect(models.getByText("Sonnet 5.5")).toBeInTheDocument();
		expect(models.getByText("1M")).toBeInTheDocument();
		expect(models.getByText("≈ $0.48")).toBeInTheDocument();
		expect(models.getByText("Opus 5.5")).toBeInTheDocument();
		expect(models.getByText("853K")).toBeInTheDocument();
		expect(models.getByText("≈ $0.78")).toBeInTheDocument();
	});

	it("says a model has no price rather than showing a wrong cost", () => {
		const unpriced: ClaudeUsageState = {
			status: "ready",
			summary: {
				...busyDay,
				month: {
					...busyDay.month,
					byModel: [
						{ model: "claude-future-9", displayName: "Future 9", tokens: 5_000, costUsd: null }
					]
				},
				unpricedModels: ["claude-future-9"]
			}
		};

		renderView({ usage: unpriced });

		expect(screen.getByText("no price")).toBeInTheDocument();
		expect(screen.getByText(/No price known for one model/)).toBeInTheDocument();
	});

	it("offers to set a budget when there is none", () => {
		renderView({ budgetUsd: null });

		expect(screen.getByRole("button", { name: "Set budget" })).toBeInTheDocument();
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
	});

	it("saves a budget the user types", async () => {
		const { props } = renderView({ budgetUsd: null });
		await userEvent.click(screen.getByRole("button", { name: "Set budget" }));

		await userEvent.type(screen.getByLabelText("Monthly budget in dollars"), "$50");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(props.onSetBudget).toHaveBeenCalledWith(50);
		expect(screen.queryByLabelText("Monthly budget in dollars")).not.toBeInTheDocument();
	});

	it("does not save something that is not an amount, and keeps the field open", async () => {
		const { props } = renderView({ budgetUsd: null });
		await userEvent.click(screen.getByRole("button", { name: "Set budget" }));

		await userEvent.type(screen.getByLabelText("Monthly budget in dollars"), "lots");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(props.onSetBudget).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Monthly budget in dollars")).toBeInTheDocument();
	});

	it("removes the budget when the field is saved empty", async () => {
		const { props } = renderView({ budgetUsd: 50 });
		await userEvent.click(screen.getByRole("button", { name: /budget/ }));

		await userEvent.clear(screen.getByLabelText("Monthly budget in dollars"));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(props.onSetBudget).toHaveBeenCalledWith(null);
	});

	it("shows how much of the budget is used", () => {
		renderView({ budgetUsd: 20 });

		expect(screen.getByRole("button", { name: "of $20.00 budget" })).toBeInTheDocument();
		expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAttribute(
			"aria-valuenow",
			"60"
		);
	});

	it("warns when the month is close to the budget", () => {
		renderView({ budgetUsd: 14 });

		expect(screen.getByText(/Close to the budget/)).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveClass("close");
	});

	it("says when the month is over the budget", () => {
		renderView({ budgetUsd: 10 });

		expect(screen.getByText(/Over budget/)).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveClass("over");
	});
});
