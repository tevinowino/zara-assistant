import { describe, expect, it } from "vitest";
import { createInitialState, sessionReducer, streamingMessageOf } from "./sessionReducer";
import type { ChatMessage, ChatOutcome } from "./types";

const outcome: ChatOutcome = {
	text: "Three minutes.",
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
};

const userMessage: ChatMessage = { id: "u1", role: "user", text: "timer?", createdAt: 1000 };

function sending() {
	return sessionReducer(createInitialState("c1"), { type: "send-started", message: userMessage });
}

describe("how an answer is reached, in the session", () => {
	it("starts understanding the question when a message is sent", () => {
		const state = sending();

		expect(state.thinking).toEqual({
			startedAt: 1000,
			endedAt: null,
			steps: [{ kind: "understand", startedAt: 1000, endedAt: null }],
			reasoning: ""
		});
	});

	it("has no thinking before anything is asked", () => {
		expect(createInitialState("c1").thinking).toBeNull();
	});

	it("moves to the stage the backend reports, using the time the report arrived", () => {
		const state = sessionReducer(sending(), {
			type: "status",
			status: "looking-at-screen",
			at: 1700
		});

		expect(state.thinking?.steps).toEqual([
			{ kind: "understand", startedAt: 1000, endedAt: 1700 },
			{ kind: "screen", startedAt: 1700, endedAt: null }
		]);
		expect(state.status).toBe("looking-at-screen");
	});

	it("keeps the model's reasoning as it grows, each report replacing the last", () => {
		let state = sessionReducer(sending(), { type: "reasoning", text: "Check the" });
		state = sessionReducer(state, { type: "reasoning", text: "Check the timer length." });

		expect(state.thinking?.reasoning).toBe("Check the timer length.");
	});

	it("ignores reasoning and stages when nothing is being asked", () => {
		const idle = createInitialState("c1");

		expect(sessionReducer(idle, { type: "reasoning", text: "late" })).toBe(idle);
		expect(sessionReducer(idle, { type: "status", status: "reading-notes", at: 5 })).toBe(idle);
	});

	it("ends thinking when the first words of the answer arrive", () => {
		const state = sessionReducer(sending(), { type: "stream-delta", text: "Three", at: 2300 });

		expect(state.thinking?.endedAt).toBe(2300);
		expect(state.thinking?.steps).toEqual([{ kind: "understand", startedAt: 1000, endedAt: 2300 }]);
	});

	it("keeps reasoning that arrives after the answer began out of the trace", () => {
		let state = sessionReducer(sending(), { type: "reasoning", text: "Before." });
		state = sessionReducer(state, { type: "stream-delta", text: "Three", at: 2300 });
		state = sessionReducer(state, { type: "reasoning", text: "Before. After." });

		expect(state.thinking?.reasoning).toBe("Before.");
	});

	it("shows the trace on the answer that is being written", () => {
		const state = sessionReducer(sending(), { type: "stream-delta", text: "Three", at: 2300 });

		expect(streamingMessageOf(state)?.thinking?.endedAt).toBe(2300);
	});

	it("gives the finished answer the trace of how it was reached", () => {
		let state = sessionReducer(sending(), { type: "status", status: "reading-notes", at: 1500 });
		state = sessionReducer(state, { type: "stream-delta", text: "Three", at: 2000 });
		const answer: ChatMessage = {
			id: "u1:reply",
			role: "assistant",
			text: "Three minutes.",
			createdAt: 2600
		};

		state = sessionReducer(state, { type: "reply-received", message: answer, outcome });

		const finished = state.messages[state.messages.length - 1];
		expect(finished.thinking?.endedAt).toBe(2000);
		expect(finished.thinking?.steps.map((step) => step.kind)).toEqual(["understand", "notes"]);
		expect(state.thinking).toBeNull();
	});

	it("ends thinking when a reply arrives with no streamed words before it", () => {
		const answer: ChatMessage = {
			id: "u1:reply",
			role: "assistant",
			text: "Three minutes.",
			createdAt: 2600
		};

		const state = sessionReducer(sending(), { type: "reply-received", message: answer, outcome });

		expect(state.messages[1].thinking?.endedAt).toBe(2600);
	});

	it("drops the trace when the question fails", () => {
		const state = sessionReducer(sending(), {
			type: "failed",
			error: { kind: "timeout", message: "Timed out." }
		});

		expect(state.thinking).toBeNull();
	});
});
