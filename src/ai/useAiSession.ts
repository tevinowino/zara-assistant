import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import {
	aiCancelChat,
	aiChat,
	convGenerateTitle,
	convLoad,
	convRename,
	convSave,
	memoryDelete,
	memoryList,
	toAiError
} from "./api";
import { buildHistoryForRequest } from "./lib/chatHistory";
import { throttleLatest } from "./lib/throttleLatest";
import { readLastConversationId, rememberLastConversationId } from "./lastConversation";
import {
	answerIdFor,
	createInitialState,
	sessionReducer,
	streamingMessageOf,
	type SessionState
} from "./sessionReducer";
import type { ChatMessage } from "./types";

/** How often, at most, the answer and the reasoning being streamed are drawn again. */
const STREAM_DRAW_INTERVAL_MS = 60;

/** Where the user was reading in the answers, so reopening the panel returns there. */
export interface ScrollMemory {
	top: number;
	/** Following the newest message rather than reading history. */
	pinnedToBottom: boolean;
}

export interface UseAiSessionOptions {
	/** Pick the last conversation up again at launch instead of starting a fresh one. */
	resumeLast?: boolean;
}

export interface AiSession extends SessionState {
	/** The assistant message being written right now, or null when no reply is in progress. */
	streamingMessage: ChatMessage | null;
	/**
	 * The title of the conversation picked up at launch, until the user sends a
	 * message or starts a new one; null otherwise. Lets the panel say it is
	 * continuing something rather than starting over.
	 */
	resumedTitle: string | null;
	/** The title of the conversation on screen; null until it has one (a new chat has none). */
	title: string | null;
	/** Text typed into the message box but not sent. Lives here so closing the notch keeps it. */
	draft: string;
	setDraft: (text: string) => void;
	/** Where the user was reading; written by the panel, read when it reopens. */
	scrollMemory: MutableRefObject<ScrollMemory | null>;
	/** Sends a message. Ignored while another is in flight or when blank. */
	send: (text: string) => Promise<void>;
	/** Stops the question being answered and puts it back in the box. */
	cancel: () => void;
	/** Sends the message that failed, after an error. */
	retry: () => Promise<void>;
	/** Starts a fresh conversation. */
	reset: () => void;
	/** Opens a saved conversation, replacing the current one. */
	load: (conversationId: string) => Promise<void>;
	dismissNotices: () => void;
	/** Removes a fact the assistant just saved to memory. */
	undoMemory: (text: string) => Promise<void>;
}

function newId(): string {
	return crypto.randomUUID();
}

function newMessage(role: ChatMessage["role"], text: string): ChatMessage {
	return { id: newId(), role, text, createdAt: Date.now() };
}

/**
 * The assistant conversation. It starts fresh, unless `resumeLast` is set and the
 * conversation the user was last in can still be read, in which case that one is
 * picked up. Every conversation is saved after each answer, and the first
 * exchange earns it a better title.
 *
 * Mounted once by the notch (not by the panel) so the conversation survives the
 * notch collapsing and reopening.
 */
export function useAiSession({ resumeLast = false }: UseAiSessionOptions = {}): AiSession {
	const [state, dispatch] = useReducer(sessionReducer, undefined, () =>
		createInitialState(newId())
	);
	const [resumedTitle, setResumedTitle] = useState<string | null>(null);
	const [title, setTitle] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const scrollMemory = useRef<ScrollMemory | null>(null);
	const resumeAtLaunch = useRef(resumeLast);
	// Handlers read the latest state without re-creating themselves on every render.
	const latest = useRef(state);
	latest.current = state;

	// Pick up the last conversation once at launch. The id is only remembered after
	// this settles, so the fresh conversation id cannot overwrite the saved one
	// before it has been read.
	const [resumeSettled, setResumeSettled] = useState(false);
	useEffect(() => {
		let cancelled = false;
		const settle = () => {
			if (!cancelled) setResumeSettled(true);
		};
		const lastId = resumeAtLaunch.current ? readLastConversationId() : null;
		if (!lastId) {
			settle();
			return () => {
				cancelled = true;
			};
		}
		convLoad(lastId)
			.then((conversation) => {
				// A message the user already sent while this loaded wins over resuming.
				if (cancelled || !conversation || conversation.messages.length === 0) return;
				if (latest.current.messages.length > 0) return;
				dispatch({
					type: "loaded",
					conversationId: conversation.id,
					messages: conversation.messages
				});
				setResumedTitle(conversation.title);
				setTitle(conversation.title);
			})
			.catch(() => {
				// An unreadable saved conversation just means starting fresh.
			})
			.finally(settle);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (resumeSettled) rememberLastConversationId(state.conversationId);
	}, [resumeSettled, state.conversationId]);

	useEffect(() => {
		// The answer and the reasoning each arrive as the whole text so far, many times a
		// second. Drawing every one would keep the page busy with text already out of date,
		// so a few a second are drawn, and always the newest.
		const reasoning = throttleLatest<string>(
			(text) => dispatch({ type: "reasoning", text }),
			STREAM_DRAW_INTERVAL_MS
		);
		const answer = throttleLatest<string>(
			(text) => dispatch({ type: "stream-delta", text, at: Date.now() }),
			STREAM_DRAW_INTERVAL_MS
		);
		const unlistenStatus = listen<string>("ai-chat-status", (event) => {
			// What was thought so far belongs before whatever stage comes next.
			reasoning.flush();
			dispatch({ type: "status", status: event.payload, at: Date.now() });
		});
		// The model's own reasoning so far, for the services that send it.
		const unlistenReasoning = listen<string>("ai-chat-reasoning", (event) => {
			reasoning.push(event.payload);
		});
		const unlistenDelta = listen<string>("ai-chat-delta", (event) => {
			// The first words of the answer end the thinking, so the last of it must be in first.
			reasoning.flush();
			answer.push(event.payload);
		});
		return () => {
			reasoning.cancel();
			answer.cancel();
			unlistenStatus.then((stop) => stop());
			unlistenReasoning.then((stop) => stop());
			unlistenDelta.then((stop) => stop());
		};
	}, []);

	const send = useCallback(async (text: string) => {
		const trimmed = text.trim();
		const before = latest.current;
		if (!trimmed || before.phase === "sending") return;

		const prior = before.messages;
		const userMessage = newMessage("user", trimmed);
		setResumedTitle(null);
		dispatch({ type: "send-started", message: userMessage });

		try {
			const outcome = await aiChat(trimmed, buildHistoryForRequest(prior));
			const answer = { ...newMessage("assistant", outcome.text), id: answerIdFor(userMessage) };
			dispatch({ type: "reply-received", message: answer, outcome, for: userMessage.id });

			// Saving and titling are best effort: the answer is already on screen.
			const conversationId = before.conversationId;
			try {
				await convSave(conversationId, [...prior, userMessage, answer]);
				if (prior.length === 0) {
					const { title } = await convGenerateTitle(trimmed, outcome.text);
					if (title) {
						await convRename(conversationId, title);
						// The user may have moved to another chat while the title was written.
						if (latest.current.conversationId === conversationId) setTitle(title);
					}
				}
			} catch {
				// Persistence problems must never replace a good answer with an error.
			}
		} catch (error) {
			const failure = toAiError(error);
			// A question that was stopped, or replaced by another, has nothing to report.
			if (failure.kind === "cancelled") return;
			dispatch({ type: "failed", error: failure, for: userMessage.id });
		}
	}, []);

	/** Stops the question in flight, so its answer cannot turn up in whatever chat comes next. */
	const stopQuestionInFlight = useCallback(() => {
		if (latest.current.phase === "sending") void aiCancelChat().catch(() => {});
	}, []);

	const cancel = useCallback(() => {
		const { phase, failedText } = latest.current;
		if (phase !== "sending") return;
		stopQuestionInFlight();
		dispatch({ type: "cancelled" });
		// The question goes back in the box, to change or send again.
		if (failedText) setDraft(failedText);
	}, [stopQuestionInFlight]);

	const retry = useCallback(async () => {
		const { failedText } = latest.current;
		if (!failedText) return;
		dispatch({ type: "retry-prepared" });
		await send(failedText);
	}, [send]);

	const reset = useCallback(() => {
		stopQuestionInFlight();
		setResumedTitle(null);
		setTitle(null);
		scrollMemory.current = null;
		dispatch({ type: "reset", conversationId: newId() });
	}, [stopQuestionInFlight]);

	const load = useCallback(
		async (conversationId: string) => {
			const conversation = await convLoad(conversationId);
			if (conversation) {
				stopQuestionInFlight();
				setResumedTitle(null);
				setTitle(conversation.title);
				scrollMemory.current = null;
				dispatch({
					type: "loaded",
					conversationId: conversation.id,
					messages: conversation.messages
				});
			}
		},
		[stopQuestionInFlight]
	);

	const dismissNotices = useCallback(() => dispatch({ type: "notices-dismissed" }), []);

	const undoMemory = useCallback(async (text: string) => {
		try {
			const entry = (await memoryList()).find((memory) => memory.text === text);
			if (entry) await memoryDelete(entry.id);
		} finally {
			dispatch({ type: "notices-dismissed" });
		}
	}, []);

	return {
		...state,
		streamingMessage: streamingMessageOf(state),
		resumedTitle,
		title,
		draft,
		setDraft,
		scrollMemory,
		send,
		cancel,
		retry,
		reset,
		load,
		dismissNotices,
		undoMemory
	};
}
