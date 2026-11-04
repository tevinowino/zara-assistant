import { describe, expect, it } from "vitest";
import {
	answerIdFor,
	createInitialState,
	sessionReducer,
	streamingMessageOf,
	type SessionState
} from "./sessionReducer";
import type { ChatMessage } from "./types";

const userMessage: ChatMessage = { id: "u1", role: "user", text: "hello", createdAt: 1 };

function sending(): SessionState {
	return sessionReducer(createInitialState("c1"), { type: "send-started", message: userMessage });
}

describe("sessionReducer streaming", () => {
	it("holds no streamed text until some arrives", () => {
		expect(createInitialState("c1").streamingText).toBeNull();
		expect(sending().streamingText).toBeNull();
	});

	it("keeps the answer so far while a reply is being written", () => {
		const state = sessionReducer(sending(), { type: "stream-delta", text: "Steep it for" });

		expect(state.streamingText).toBe("Steep it for");
	});

	it("replaces the answer so far with the longer one each time", () => {
		let state = sessionReducer(sending(), { type: "stream-delta", text: "Steep" });

		state = sessionReducer(state, { type: "stream-delta", text: "Steep it for three minutes." });

		expect(state.streamingText).toBe("Steep it for three minutes.");
	});

	it("ignores a late update after the reply has finished", () => {
		const idle = createInitialState("c1");

		expect(sessionReducer(idle, { type: "stream-delta", text: "late" })).toBe(idle);
	});

	it("drops the streamed text when the final reply arrives", () => {
		let state = sessionReducer(sending(), { type: "stream-delta", text: "Steep it" });

		state = sessionReducer(state, {
			type: "reply-received",
			message: {
				id: answerIdFor(userMessage),
				role: "assistant",
				text: "Steep it well.",
				createdAt: 2
			},
			outcome: {
				text: "Steep it well.",
				usedScreen: false,
				usedNotes: false,
				savedMemories: [],
				noteChanges: []
			}
		});

		expect(state.streamingText).toBeNull();
		expect(state.messages.at(-1)?.text).toBe("Steep it well.");
	});

	it("drops the streamed text when the request fails", () => {
		let state = sessionReducer(sending(), { type: "stream-delta", text: "Half an answ" });

		state = sessionReducer(state, {
			type: "failed",
			error: { kind: "network", message: "offline" }
		});

		expect(state.streamingText).toBeNull();
		expect(state.phase).toBe("error");
	});

	it("drops the streamed text when a new conversation is started", () => {
		const state = sessionReducer(
			sessionReducer(sending(), { type: "stream-delta", text: "Steep it" }),
			{ type: "reset", conversationId: "c2" }
		);

		expect(state.streamingText).toBeNull();
	});
});

describe("streamingMessageOf", () => {
	it("is the assistant message being written, with the id the final reply will have", () => {
		const state = sessionReducer(sending(), { type: "stream-delta", text: "Steep it" });

		expect(streamingMessageOf(state)).toMatchObject({
			id: answerIdFor(userMessage),
			role: "assistant",
			text: "Steep it"
		});
	});

	it("is null when nothing has been streamed yet", () => {
		expect(streamingMessageOf(sending())).toBeNull();
	});

	it("is null once the reply is complete", () => {
		const idle = createInitialState("c1");

		expect(streamingMessageOf(idle)).toBeNull();
	});
});
