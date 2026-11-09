import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import { MAX_BUDGET_USD } from "./usageFormat";

export const CLAUDE_USAGE_SETTING_KEYS = {
	/** The user allows Zara to count Claude Code's usage from its transcript files. */
	allowed: "zara-claude-usage-enabled",
	/** The monthly budget in dollars; unset for none. */
	budgetUsd: "zara-claude-usage-budget-usd"
} as const;

export interface ClaudeUsagePreferences {
	allowed: boolean;
	budgetUsd: number | null;
}

/** Reads the preferences through `read`, which returns null for a setting never saved. */
export function parseClaudeUsagePreferences(
	read: (key: string) => string | null | undefined
): ClaudeUsagePreferences {
	const budget = Number(read(CLAUDE_USAGE_SETTING_KEYS.budgetUsd));
	return {
		allowed: read(CLAUDE_USAGE_SETTING_KEYS.allowed) === "true",
		budgetUsd: Number.isFinite(budget) && budget > 0 && budget <= MAX_BUDGET_USD ? budget : null
	};
}

const readStored = () =>
	parseClaudeUsagePreferences((key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	});

export interface ClaudeUsagePreferencesController extends ClaudeUsagePreferences {
	setAllowed: (allowed: boolean) => void;
	/** Sets the monthly budget; null removes it. */
	setBudgetUsd: (budgetUsd: number | null) => void;
}

/**
 * Whether Claude Code's usage may be counted, and the user's monthly budget; shared by the
 * notch and the Settings window. Counting is off until the user allows it.
 */
export function useClaudeUsagePreferences(): ClaudeUsagePreferencesController {
	const [preferences, setPreferences] = useState(readStored);

	// The sync hook has already mirrored the changed value into localStorage when it calls us.
	useSettingsSync(
		Object.fromEntries(
			Object.values(CLAUDE_USAGE_SETTING_KEYS).map((key) => [
				key,
				() => setPreferences(readStored())
			])
		)
	);

	const save = useCallback((key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			// The saved file is the source of truth; the browser's copy is only for the first paint.
		}
		setPreferences(readStored());
		invoke("save_setting", { key, value }).catch(() => {});
	}, []);

	return {
		...preferences,
		setAllowed: (allowed) => save(CLAUDE_USAGE_SETTING_KEYS.allowed, String(allowed)),
		setBudgetUsd: (budgetUsd) =>
			save(CLAUDE_USAGE_SETTING_KEYS.budgetUsd, budgetUsd === null ? "" : String(budgetUsd))
	};
}
