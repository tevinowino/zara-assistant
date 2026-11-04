import { parseMessageContent } from "../protocol/parse";
import type { ChatMessage, HistoryTurn } from "../types";

// Re-sending a widget's full JSON in history would use up the context budget fast
// (a five-turn conversation with three tables is mostly JSON), and the model
// only needs to know a widget was shown, for follow-ups like "make that a bar
// chart instead". So blocks collapse to a placeholder such as "[table]".
function collapseBlocksToPlaceholders(text: string): string {
	return parseMessageContent(text)
		.map((segment) => {
			if (segment.kind === "markdown") return segment.text.trim();
			return `[${segment.kind === "surface" ? "a2ui" : segment.type}]`;
		})
		.join("\n\n");
}

const HISTORY_TURN_LIMIT = 8;

/**
 * The turns to send with a request. Pass the messages that existed BEFORE the
 * one being sent; that message goes separately.
 */
export function buildHistoryForRequest(priorMessages: ChatMessage[]): HistoryTurn[] {
	return priorMessages.slice(-HISTORY_TURN_LIMIT).map((message) => ({
		role: message.role === "user" ? "user" : "model",
		text: message.role === "assistant" ? collapseBlocksToPlaceholders(message.text) : message.text
	}));
}
