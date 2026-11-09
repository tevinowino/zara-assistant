import { useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ClaudeUsageState } from "../claudeCode/useClaudeUsage";
import type { ModelUsage, UsageSummary } from "../claudeCode/usageTypes";
import {
	budgetState,
	formatHour,
	formatHourRange,
	formatTokens,
	formatUsd,
	parseBudget
} from "../claudeCode/usageFormat";

/** The hours labelled under the chart. */
const AXIS_HOURS = [0, 6, 12, 18];

/** Where Claude shows a person's plan usage. */
export const PLAN_USAGE_URL = "https://claude.ai/settings/usage";

export interface ClaudeUsageViewProps {
	/** The user has allowed Zara to count Claude Code's usage. */
	allowed: boolean;
	onAllow: () => void;
	usage: ClaudeUsageState;
	/** The monthly budget in dollars, or null for none. */
	budgetUsd: number | null;
	onSetBudget: (budgetUsd: number | null) => void;
}

/**
 * Claude Code's usage: today's tokens, messages, tool calls and sessions, the hours it was used,
 * this month's estimated cost against an optional budget, and the month by model. Costs are
 * estimates at public API prices, not what a subscription charges.
 */
export function ClaudeUsageView({
	allowed,
	onAllow,
	usage,
	budgetUsd,
	onSetBudget
}: ClaudeUsageViewProps) {
	if (!allowed) return <ConsentCard onAllow={onAllow} />;
	if (usage.status === "loading" || usage.status === "off") {
		return <p className="cu-message">Counting Claude Code's usage…</p>;
	}
	if (usage.status === "error") {
		return <p className="cu-message">Claude Code's usage could not be read.</p>;
	}
	if (!usage.summary.anyUsage) {
		return (
			<p className="cu-message">No Claude Code usage found yet. Use it and it shows up here.</p>
		);
	}
	return <Dashboard summary={usage.summary} budgetUsd={budgetUsd} onSetBudget={onSetBudget} />;
}

function ConsentCard({ onAllow }: { onAllow: () => void }) {
	return (
		<section className="cu-card cu-consent" aria-label="Allow usage counting">
			<h3>See your Claude Code usage</h3>
			<p>
				Zara can count your tokens, messages and tool calls from the transcript files Claude Code
				keeps on this PC. It keeps only the counts, never what was said, and nothing leaves your PC.
				You can turn it off in Settings.
			</p>
			<button type="button" className="cu-button" onClick={onAllow}>
				Allow
			</button>
		</section>
	);
}

function Dashboard({
	summary,
	budgetUsd,
	onSetBudget
}: {
	summary: UsageSummary;
	budgetUsd: number | null;
	onSetBudget: (budgetUsd: number | null) => void;
}) {
	return (
		<div className="cu-grid">
			<TodayCard summary={summary} />
			<MonthCard summary={summary} budgetUsd={budgetUsd} onSetBudget={onSetBudget} />
			<HoursCard summary={summary} />
			<ModelsCard summary={summary} />
		</div>
	);
}

function TodayCard({ summary }: { summary: UsageSummary }) {
	const { today } = summary;
	return (
		<section className="cu-card cu-today" aria-label="Today">
			<h3>Today</h3>
			<div className="cu-today-main">
				<div>
					<div className="cu-big">
						{formatTokens(today.tokens)} <span>tokens</span>
					</div>
					<div className="cu-sub">≈ {formatUsd(today.costUsd)} API value today</div>
				</div>
				<dl className="cu-stats">
					<Stat label="Messages" value={today.messages} />
					<Stat label="Tool calls" value={today.toolCalls} />
					<Stat label="Sessions" value={today.sessions} />
				</dl>
			</div>
			{(today.topProject || today.streakDays > 0) && (
				<p className="cu-foot">
					{today.topProject && <span>{today.topProject}</span>}
					{today.topProject && today.streakDays > 0 && " · "}
					{today.streakDays > 0 && <span>{today.streakDays}-day streak</span>}
				</p>
			)}
		</section>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="cu-stat">
			<dd>{value}</dd>
			<dt>{label}</dt>
		</div>
	);
}

function HoursCard({ summary }: { summary: UsageSummary }) {
	const { hourlyTokens, peakStartHour, currentHour } = summary.today;
	const busiest = Math.max(...hourlyTokens, 1);
	return (
		<section className="cu-card cu-hours" aria-label="Active hours">
			<header>
				<h3>Active hours</h3>
				{peakStartHour !== null && <span>Peak {formatHourRange(peakStartHour)}</span>}
			</header>
			<div className="cu-bars" role="img" aria-label="Tokens used in each hour of today">
				{hourlyTokens.map((tokens, hour) => (
					<span
						key={hour}
						className={`cu-bar${tokens > 0 ? " used" : ""}${hour === currentHour ? " now" : ""}`}
						style={tokens > 0 ? { height: `${Math.max(8, (tokens / busiest) * 100)}%` } : undefined}
					/>
				))}
			</div>
			<div className="cu-axis" aria-hidden="true">
				{AXIS_HOURS.map((hour) => (
					<span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
						{formatHour(hour)}
					</span>
				))}
			</div>
		</section>
	);
}

function MonthCard({
	summary,
	budgetUsd,
	onSetBudget
}: {
	summary: UsageSummary;
	budgetUsd: number | null;
	onSetBudget: (budgetUsd: number | null) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const cost = summary.month.costUsd;
	const state = budgetUsd ? budgetState(cost, budgetUsd) : null;

	const saveBudget = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim() === "") {
			onSetBudget(null);
			setEditing(false);
			return;
		}
		const parsed = parseBudget(draft);
		if (parsed === null) return;
		onSetBudget(parsed);
		setEditing(false);
	};

	return (
		<section className="cu-card cu-month" aria-label="This month">
			<header>
				<h3>This month</h3>
				<button type="button" className="cu-link" onClick={() => void openUrl(PLAN_USAGE_URL)}>
					View plan usage ↗
				</button>
			</header>
			<div className="cu-month-main">
				<div className="cu-big">≈ {formatUsd(cost)}</div>
				{editing ? (
					<form className="cu-budget-form" onSubmit={saveBudget}>
						<input
							aria-label="Monthly budget in dollars"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder="e.g. 50"
							inputMode="decimal"
							autoFocus
						/>
						<button type="submit" className="cu-button">
							Save
						</button>
					</form>
				) : (
					<button
						type="button"
						className="cu-link cu-budget-button"
						onClick={() => {
							setDraft(budgetUsd ? String(budgetUsd) : "");
							setEditing(true);
						}}
					>
						{budgetUsd ? `of ${formatUsd(budgetUsd)} budget` : "Set budget"}
					</button>
				)}
			</div>
			{budgetUsd && state && (
				<div
					className={`cu-budget-bar ${state}`}
					role="progressbar"
					aria-label="Budget used"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.min(100, Math.round((cost / budgetUsd) * 100))}
				>
					<span style={{ width: `${Math.min(100, (cost / budgetUsd) * 100)}%` }} />
				</div>
			)}
			<p className="cu-foot">
				{state === "over" ? "Over budget · " : state === "close" ? "Close to the budget · " : ""}
				Estimated at API prices
			</p>
			{summary.unpricedModels.length > 0 && (
				<p className="cu-foot cu-warning">
					No price known for {summary.unpricedModels.length === 1 ? "one model" : "some models"}, so
					its cost is missing.
				</p>
			)}
		</section>
	);
}

function ModelsCard({ summary }: { summary: UsageSummary }) {
	const models = summary.month.byModel;
	const totalTokens = Math.max(summary.month.tokens, 1);
	return (
		<section className="cu-card cu-models" aria-label="By model">
			<h3>By model</h3>
			<ul>
				{models.map((model) => (
					<ModelRow key={model.model} model={model} share={model.tokens / totalTokens} />
				))}
			</ul>
		</section>
	);
}

function ModelRow({ model, share }: { model: ModelUsage; share: number }) {
	return (
		<li className="cu-model">
			<div className="cu-model-top">
				<span className="cu-model-name">{model.displayName}</span>
				<span className="cu-model-tokens">{formatTokens(model.tokens)}</span>
			</div>
			<div className="cu-model-bottom">
				<span className="cu-model-share" aria-hidden="true">
					<span style={{ width: `${Math.max(2, share * 100)}%` }} />
				</span>
				<span className="cu-model-cost">
					{model.costUsd === null ? "no price" : `≈ ${formatUsd(model.costUsd)}`}
				</span>
			</div>
		</li>
	);
}
