import { describe, expect, it } from "vitest";
import { createInitialState, sessionReducer } from "./sessionReducer";
import type { ChatMessage, ChatOutcome } from "./types";

const outcome: ChatOutcome = {
	text: "x",
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
};

const premierLeague: ChatMessage = {
	id: "q1",
	role: "user",
	text: "premier league matches",
	createdAt: 1000
};
const screenQuestion: ChatMessage = {
	id: "q2",
	role: "user",
	text: "what is on my screen?",
	createdAt: 2000
};

describe("which question a reply belongs to", () => {
	it("remembers the question being answered", () => {
		const state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: premierLeague
		});

		expect(state.pending).toBe("q1");
	});

	it("takes a reply that names the question being answered", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: premierLeague
		});

		state = sessionReducer(state, {
			type: "reply-received",
			message: { id: "q1:reply", role: "assistant", text: "Arsenal won.", createdAt: 1500 },
			outcome,
			for: "q1"
		});

		expect(state.messages.map((message) => message.text)).toEqual([
			"premier league matches",
			"Arsenal won."
		]);
		expect(state.pending).toBeNull();
	});

	it("does not take a reply for another question as the answer, even while a question is waiting", () => {
		// The Premier League question was left behind in a chat that was closed; now the
		// screen question is waiting, and the old reply turns up.
		const waiting = sessionReducer(createInitialState("c2"), {
			type: "send-started",
			message: screenQuestion
		});

		const after = sessionReducer(waiting, {
			type: "reply-received",
			message: { id: "q1:reply", role: "assistant", text: "Arsenal won.", createdAt: 3000 },
			outcome,
			for: "q1"
		});

		expect(after).toBe(waiting);
		expect(after.phase).toBe("sending");
		expect(after.messages.map((message) => message.text)).toEqual(["what is on my screen?"]);
		const answered = sessionReducer(after, {
			type: "reply-received",
			message: { id: "q2:reply", role: "assistant", text: "A terminal.", createdAt: 3500 },
			outcome,
			for: "q2"
		});
		expect(answered.messages[answered.messages.length - 1].text).toBe("A terminal.");
	});

	it("does not take a failure of another question for this one", () => {
		const waiting = sessionReducer(createInitialState("c2"), {
			type: "send-started",
			message: screenQuestion
		});

		const after = sessionReducer(waiting, {
			type: "failed",
			error: { kind: "timeout", message: "Too slow." },
			for: "q1"
		});

		expect(after).toBe(waiting);
	});
});

describe("stopping a question", () => {
	it("takes the question out of the chat and goes back to idle", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: premierLeague
		});
		state = sessionReducer(state, { type: "status", status: "looking-at-screen", at: 1200 });
		state = sessionReducer(state, { type: "stream-delta", text: "Half an", at: 1400 });

		state = sessionReducer(state, { type: "cancelled" });

		expect(state.phase).toBe("idle");
		expect(state.messages).toEqual([]);
		expect(state.streamingText).toBeNull();
		expect(state.thinking).toBeNull();
		expect(state.status).toBeNull();
		expect(state.pending).toBeNull();
		expect(state.failedText).toBeNull();
	});

	it("keeps the conversation that came before the stopped question", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: premierLeague
		});
		state = sessionReducer(state, {
			type: "reply-received",
			message: { id: "q1:reply", role: "assistant", text: "Arsenal won.", createdAt: 1500 },
			outcome
		});
		state = sessionReducer(state, { type: "send-started", message: screenQuestion });

		state = sessionReducer(state, { type: "cancelled" });

		expect(state.messages.map((message) => message.text)).toEqual([
			"premier league matches",
			"Arsenal won."
		]);
	});

	it("does nothing when no question is being answered", () => {
		const idle = createInitialState("c1");

		expect(sessionReducer(idle, { type: "cancelled" })).toBe(idle);
	});

	it("ignores the answer of the stopped question if it turns up anyway", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: premierLeague
		});
		state = sessionReducer(state, { type: "cancelled" });

		const after = sessionReducer(state, {
			type: "reply-received",
			message: { id: "q1:reply", role: "assistant", text: "Arsenal won.", createdAt: 1500 },
			outcome,
			for: "q1"
		});

		expect(after).toBe(state);
	});
});
