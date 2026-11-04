import { advanceTrace, endTrace, startTrace, withReasoning } from "./lib/thinkingTrace";
import type { AiErrorInfo, ChatMessage, ChatOutcome, ThinkingTrace } from "./types";

/**
 * What the assistant tells the user it did on its own while answering, shown
 * under the reply so a model-driven change is never silent.
 */
export interface Notice {
	kind: "memory" | "note";
	text: string;
}

export type SessionPhase = "idle" | "sending" | "error";

export interface SessionState {
	conversationId: string;
	messages: ChatMessage[];
	phase: SessionPhase;
	/** Progress label while sending: "looking-at-screen", "reading-notes", or null. */
	status: string | null;
	error: AiErrorInfo | null;
	/** The text of the message that failed, so Retry can send it again. */
	failedText: string | null;
	/**
	 * The answer so far while a reply is still being written; null before the
	 * first words arrive and once the reply is complete.
	 */
	streamingText: string | null;
	/** How the answer being worked out is coming along; null when nothing is being asked. */
	thinking: ThinkingTrace | null;
	/**
	 * The id of the message being answered; null when none is. A reply says which
	 * message it answers, and one that is not this one (it belongs to a chat that was
	 * left, or to a question that was stopped) is not taken for the answer.
	 */
	pending: string | null;
	notices: Notice[];
}

export type SessionAction =
	| { type: "send-started"; message: ChatMessage }
	/** `at` is the time the event arrived; without it the step is taken to have happened at once. */
	| { type: "status"; status: string; at?: number }
	| { type: "reasoning"; text: string }
	| { type: "stream-delta"; text: string; at?: number }
	/** `for` is the id of the message answered; without it the reply is taken to be for the pending one. */
	| { type: "reply-received"; message: ChatMessage; outcome: ChatOutcome; for?: string }
	| { type: "failed"; error: AiErrorInfo; for?: string }
	/** The user stopped the question being answered. */
	| { type: "cancelled" }
	| { type: "retry-prepared" }
	| { type: "notices-dismissed" }
	| { type: "reset"; conversationId: string }
	| { type: "loaded"; conversationId: string; messages: ChatMessage[] };

export function createInitialState(conversationId: string): SessionState {
	return {
		conversationId,
		messages: [],
		phase: "idle",
		status: null,
		error: null,
		failedText: null,
		streamingText: null,
		thinking: null,
		pending: null,
		notices: []
	};
}

/**
 * The id the reply to `userMessage` will have. The reply being written and the
 * finished reply share it, so the panel keeps the same element on screen when
 * the last words land instead of replacing it.
 */
export function answerIdFor(userMessage: ChatMessage): string {
	return `${userMessage.id}:reply`;
}

/** The assistant message being written right now, or null when there is none. */
export function streamingMessageOf(state: SessionState): ChatMessage | null {
	if (state.phase !== "sending" || !state.streamingText) return null;
	const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
	if (!lastUser) return null;
	return {
		id: answerIdFor(lastUser),
		role: "assistant",
		text: state.streamingText,
		createdAt: lastUser.createdAt,
		...(state.thinking ? { thinking: state.thinking } : {})
	};
}

/** The time of the latest thing that happened in a trace, for events that carry no time of their own. */
function lastTimeIn(trace: ThinkingTrace): number {
	return trace.steps[trace.steps.length - 1].startedAt;
}

/** A reply or failure that names a message other than the one being answered. */
function isForAnotherMessage(state: SessionState, answered: string | undefined): boolean {
	return answered !== undefined && answered !== state.pending;
}

function noticesFrom(outcome: ChatOutcome): Notice[] {
	return [
		...outcome.savedMemories.map((text) => ({ kind: "memory" as const, text })),
		...outcome.noteChanges.map((text) => ({ kind: "note" as const, text }))
	];
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
	switch (action.type) {
		case "send-started":
			// A second message while one is in flight is ignored; the UI disables
			// the input, and this keeps the state machine honest if it slips through.
			if (state.phase === "sending") return state;
			return {
				...state,
				messages: [...state.messages, action.message],
				phase: "sending",
				status: null,
				error: null,
				failedText: action.message.text,
				streamingText: null,
				thinking: startTrace(action.message.createdAt),
				pending: action.message.id,
				notices: []
			};
		case "status":
			if (state.phase !== "sending") return state;
			return {
				...state,
				status: action.status,
				thinking: state.thinking
					? advanceTrace(state.thinking, action.status, action.at ?? lastTimeIn(state.thinking))
					: null
			};
		case "reasoning":
			if (state.phase !== "sending" || !state.thinking) return state;
			return { ...state, thinking: withReasoning(state.thinking, action.text) };
		case "stream-delta":
			if (state.phase !== "sending") return state;
			// The first words of the answer are the end of thinking.
			return {
				...state,
				streamingText: action.text,
				thinking: state.thinking
					? endTrace(state.thinking, action.at ?? lastTimeIn(state.thinking))
					: null
			};
		case "reply-received": {
			if (state.phase !== "sending" || isForAnotherMessage(state, action.for)) return state;
			const message = state.thinking
				? { ...action.message, thinking: endTrace(state.thinking, action.message.createdAt) }
				: action.message;
			return {
				...state,
				messages: [...state.messages, message],
				phase: "idle",
				status: null,
				failedText: null,
				streamingText: null,
				thinking: null,
				pending: null,
				notices: noticesFrom(action.outcome)
			};
		}
		case "failed":
			if (state.phase !== "sending" || isForAnotherMessage(state, action.for)) return state;
			return {
				...state,
				phase: "error",
				status: null,
				streamingText: null,
				thinking: null,
				pending: null,
				error: action.error
			};
		case "cancelled": {
			if (state.phase !== "sending") return state;
			// The question is taken back: it leaves the chat, and the box gets it back to edit.
			const last = state.messages[state.messages.length - 1];
			const messages = last?.id === state.pending ? state.messages.slice(0, -1) : state.messages;
			return {
				...state,
				messages,
				phase: "idle",
				status: null,
				failedText: null,
				streamingText: null,
				thinking: null,
				pending: null
			};
		}
		case "retry-prepared": {
			if (state.phase !== "error") return state;
			// Drop the message that failed; sending it again adds it back.
			const last = state.messages[state.messages.length - 1];
			const messages = last?.role === "user" ? state.messages.slice(0, -1) : state.messages;
			return { ...state, messages, phase: "idle", error: null };
		}
		case "notices-dismissed":
			return state.notices.length === 0 ? state : { ...state, notices: [] };
		case "reset":
			return createInitialState(action.conversationId);
		case "loaded":
			return { ...createInitialState(action.conversationId), messages: action.messages };
	}
}
