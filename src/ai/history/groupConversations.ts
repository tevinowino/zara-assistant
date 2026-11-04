import type { ConversationSummary } from "../types";

export type ConversationGroupLabel = "Today" | "Yesterday" | "Last 7 days" | "Earlier";

export interface ConversationGroup {
	label: ConversationGroupLabel;
	items: ConversationSummary[];
}

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/** Midnight at the start of the local calendar day containing `timestamp`. */
function startOfLocalDay(timestamp: number): number {
	const date = new Date(timestamp);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** How many local calendar days before today `timestamp` falls; 0 for today. */
function daysAgo(timestamp: number, now: number): number {
	const days = (startOfLocalDay(now) - startOfLocalDay(timestamp)) / (24 * MILLISECONDS_PER_HOUR);
	return Math.max(0, Math.round(days));
}

function labelFor(timestamp: number, now: number): ConversationGroupLabel {
	const days = daysAgo(timestamp, now);
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return "Last 7 days";
	return "Earlier";
}

/**
 * Sorts chats into the day-based groups a history list shows. Calendar days,
 * not 24-hour windows, so a chat from 11 pm last night is "Yesterday" at 1 am.
 * Order inside a group is the order given, so pass newest first. Groups with no
 * chats are left out.
 */
export function groupConversations(
	conversations: ConversationSummary[],
	now: number
): ConversationGroup[] {
	const order: ConversationGroupLabel[] = ["Today", "Yesterday", "Last 7 days", "Earlier"];
	return order
		.map((label) => ({
			label,
			items: conversations.filter((item) => labelFor(item.updatedAt, now) === label)
		}))
		.filter((group) => group.items.length > 0);
}

/**
 * A short label for when a chat was last used: "Just now", "5 min ago",
 * "3 h ago", "Yesterday", a weekday within the week, otherwise "Oct 3".
 */
export function formatRelativeTime(timestamp: number, now: number): string {
	const elapsed = Math.max(0, now - timestamp);
	const days = daysAgo(timestamp, now);

	if (days === 0) {
		if (elapsed < MILLISECONDS_PER_MINUTE) return "Just now";
		if (elapsed < MILLISECONDS_PER_HOUR)
			return `${Math.floor(elapsed / MILLISECONDS_PER_MINUTE)} min ago`;
		return `${Math.floor(elapsed / MILLISECONDS_PER_HOUR)} h ago`;
	}
	if (days === 1) return "Yesterday";
	if (days < 7) return new Date(timestamp).toLocaleDateString("en-US", { weekday: "short" });
	return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
