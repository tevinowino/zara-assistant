/** A token count as people say it: 999, 12K, 853K, 1.9M. */
export function formatTokens(count: number): string {
	if (count < 1000) return String(Math.max(0, Math.round(count)));
	const thousands = Math.round(count / 1000);
	if (thousands < 1000) return `${thousands}K`;
	const millions = count / 1_000_000;
	if (millions < 1000) return `${trimZero(millions.toFixed(1))}M`;
	return `${trimZero((millions / 1000).toFixed(1))}B`;
}

function trimZero(text: string): string {
	return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** A dollar amount with cents: $11.99, $1,234.50. Under a cent it says so. */
export function formatUsd(amount: number): string {
	if (amount > 0 && amount < 0.005) return "<$0.01";
	return amount.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** An hour of the day: 07:00. */
export function formatHour(hour: number): string {
	return pad(hour);
}

/** The two hours from `startHour`: "20:00 – 22:00". Wraps past midnight. */
export function formatHourRange(startHour: number): string {
	return `${pad(startHour)} – ${pad((startHour + 2) % 24)}`;
}

/** The most a monthly budget can be, in dollars; a guard against a mistyped number. */
export const MAX_BUDGET_USD = 100_000;

/** A budget typed by the user: a positive amount, "$" and commas allowed; otherwise null. */
export function parseBudget(text: string): number | null {
	const cleaned = text.replace(/[$,\s]/g, "");
	if (cleaned === "") return null;
	const value = Number(cleaned);
	if (!Number.isFinite(value) || value <= 0 || value > MAX_BUDGET_USD) return null;
	return Math.round(value * 100) / 100;
}

export type BudgetState = "under" | "close" | "over";

/** How the month's cost stands against the budget: close from 80%, over from 100%. */
export function budgetState(costUsd: number, budgetUsd: number): BudgetState {
	const ratio = costUsd / budgetUsd;
	if (ratio >= 1) return "over";
	return ratio >= 0.8 ? "close" : "under";
}
