/** Today's Claude Code use, as the backend sends it. */
export interface TodayStats {
	tokens: number;
	/** Estimated cost in dollars, at public API prices. */
	costUsd: number;
	messages: number;
	toolCalls: number;
	sessions: number;
	/** The project with the most tokens today. */
	topProject: string | null;
	/** Consecutive days with use, counting back from today. */
	streakDays: number;
	/** Tokens in each hour of today (24 values), local time. */
	hourlyTokens: number[];
	/** The first hour of the busiest two-hour stretch today. */
	peakStartHour: number | null;
	currentHour: number;
}

export interface ModelUsage {
	model: string;
	/** "Sonnet 5.5". */
	displayName: string;
	tokens: number;
	/** Null when the model's price is not known. */
	costUsd: number | null;
}

export interface MonthStats {
	costUsd: number;
	tokens: number;
	/** The month's models, the costliest first. */
	byModel: ModelUsage[];
}

export interface UsageSummary {
	today: TodayStats;
	month: MonthStats;
	/** Models used this month that have no known price, so their cost is missing. */
	unpricedModels: string[];
	/** Whether any use at all was found. */
	anyUsage: boolean;
}
