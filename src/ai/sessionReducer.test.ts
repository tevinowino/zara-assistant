import { describe, expect, it } from "vitest";
import { createInitialState, sessionReducer } from "./sessionReducer";
import type { ChatMessage, ChatOutcome } from "./types";

function message(id: string, role: "user" | "assistant", text: string): ChatMessage {
	return { id, role, text, createdAt: 1 };
}

const plainOutcome: ChatOutcome = {
	text: "an answer",
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
};

describe("sessionReducer", () => {
	it("starts idle with no messages", () => {
		const state = createInitialState("c1");

		expect(state).toMatchObject({ conversationId: "c1", messages: [], phase: "idle", error: null });
	});

	it("sending adds the user's message and moves to sending", () => {
		const state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "hello")
		});

		expect(state.phase).toBe("sending");
		expect(state.messages.map((m) => m.text)).toEqual(["hello"]);
		expect(state.failedText).toBe("hello");
	});

	it("ignores a second send while one is in flight", () => {
		const sending = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "first")
		});

		const after = sessionReducer(sending, {
			type: "send-started",
			message: message("m2", "user", "second")
		});

		expect(after).toBe(sending);
	});

	it("a status update is shown only while sending", () => {
		const idle = createInitialState("c1");
		const sending = sessionReducer(idle, {
			type: "send-started",
			message: message("m1", "user", "x")
		});

		expect(sessionReducer(idle, { type: "status", status: "looking-at-screen" })).toBe(idle);
		expect(sessionReducer(sending, { type: "status", status: "looking-at-screen" }).status).toBe(
			"looking-at-screen"
		);
	});

	it("a reply adds the answer, returns to idle and clears the progress label", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});
		state = sessionReducer(state, { type: "status", status: "reading-notes" });

		state = sessionReducer(state, {
			type: "reply-received",
			message: message("m2", "assistant", "an answer"),
			outcome: plainOutcome
		});

		expect(state.phase).toBe("idle");
		expect(state.status).toBeNull();
		expect(state.failedText).toBeNull();
		expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("a reply lists what the assistant saved or changed on its own", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});

		state = sessionReducer(state, {
			type: "reply-received",
			message: message("m2", "assistant", "ok"),
			outcome: { ...plainOutcome, savedMemories: ["name is Tevin"], noteChanges: ['Added: "Milk"'] }
		});

		expect(state.notices).toEqual([
			{ kind: "memory", text: "name is Tevin" },
			{ kind: "note", text: 'Added: "Milk"' }
		]);
	});

	it("a new message clears the previous reply's notices", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});
		state = sessionReducer(state, {
			type: "reply-received",
			message: message("m2", "assistant", "ok"),
			outcome: { ...plainOutcome, savedMemories: ["a fact"] }
		});

		state = sessionReducer(state, { type: "send-started", message: message("m3", "user", "next") });

		expect(state.notices).toEqual([]);
	});

	it("a failure keeps the user's message and records the error", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});

		state = sessionReducer(state, {
			type: "failed",
			error: { kind: "rate-limited", message: "Slow down" }
		});

		expect(state.phase).toBe("error");
		expect(state.error).toEqual({ kind: "rate-limited", message: "Slow down" });
		expect(state.messages).toHaveLength(1);
		expect(state.failedText).toBe("q");
	});

	it("preparing a retry removes the failed message so sending it again does not duplicate it", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});
		state = sessionReducer(state, {
			type: "failed",
			error: { kind: "network", message: "offline" }
		});

		state = sessionReducer(state, { type: "retry-prepared" });

		expect(state.phase).toBe("idle");
		expect(state.messages).toEqual([]);
		expect(state.error).toBeNull();
		expect(state.failedText).toBe("q");
	});

	it("a retry is only possible from the error state", () => {
		const idle = createInitialState("c1");

		expect(sessionReducer(idle, { type: "retry-prepared" })).toBe(idle);
	});

	it("a failure or reply that arrives when nothing is in flight is ignored", () => {
		const idle = createInitialState("c1");

		expect(sessionReducer(idle, { type: "failed", error: { kind: "x", message: "y" } })).toBe(idle);
		expect(
			sessionReducer(idle, {
				type: "reply-received",
				message: message("m", "assistant", "late"),
				outcome: plainOutcome
			})
		).toBe(idle);
	});

	it("reset starts a fresh conversation", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});

		state = sessionReducer(state, { type: "reset", conversationId: "c2" });

		expect(state).toEqual(createInitialState("c2"));
	});

	it("loading a saved conversation replaces the messages", () => {
		const state = sessionReducer(createInitialState("c1"), {
			type: "loaded",
			conversationId: "old",
			messages: [message("m1", "user", "earlier")]
		});

		expect(state.conversationId).toBe("old");
		expect(state.messages.map((m) => m.text)).toEqual(["earlier"]);
		expect(state.phase).toBe("idle");
	});

	it("dismissing notices clears them", () => {
		let state = sessionReducer(createInitialState("c1"), {
			type: "send-started",
			message: message("m1", "user", "q")
		});
		state = sessionReducer(state, {
			type: "reply-received",
			message: message("m2", "assistant", "ok"),
			outcome: { ...plainOutcome, savedMemories: ["a fact"] }
		});

		state = sessionReducer(state, { type: "notices-dismissed" });

		expect(state.notices).toEqual([]);
	});
});
