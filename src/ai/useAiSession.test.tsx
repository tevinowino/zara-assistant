import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { useAiSession } from "./useAiSession";

const answer = (text: string) => ({
	text,
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
});

function callsTo(command: string) {
	return invokeCalls.filter((call) => call.command === command);
}

describe("useAiSession", () => {
	it("sends a message with the earlier turns and shows the answer", async () => {
		setInvokeHandler("ai_chat", () => answer("Steep it for three minutes."));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("how do I brew tea?"));

		expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([
			["user", "how do I brew tea?"],
			["assistant", "Steep it for three minutes."]
		]);
		expect(callsTo("ai_chat")[0].args).toEqual({ message: "how do I brew tea?", history: [] });
	});

	it("sends the earlier turns as history on the next message", async () => {
		setInvokeHandler("ai_chat", () => answer("an answer"));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		const { result } = renderHook(() => useAiSession());
		await act(() => result.current.send("first"));

		await act(() => result.current.send("second"));

		expect(callsTo("ai_chat")[1].args).toEqual({
			message: "second",
			history: [
				{ role: "user", text: "first" },
				{ role: "model", text: "an answer" }
			]
		});
	});

	it("ignores blank messages", async () => {
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("   "));

		// Remembering the conversation id at start-up is not part of sending.
		expect(invokeCalls.filter((call) => call.command !== "save_setting")).toEqual([]);
		expect(result.current.messages).toEqual([]);
	});

	it("saves the conversation and renames it after the first exchange only", async () => {
		setInvokeHandler("ai_chat", () => answer("an answer"));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: "Brewing tea" }));
		setInvokeHandler("conv_rename", () => ({ success: true }));
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("first"));
		await act(() => result.current.send("second"));

		expect(callsTo("conv_save")).toHaveLength(2);
		expect(callsTo("conv_generate_title")).toHaveLength(1);
		expect(callsTo("conv_rename")[0].args).toMatchObject({ title: "Brewing tea" });
	});

	it("keeps a good answer on screen even when saving fails", async () => {
		setInvokeHandler("ai_chat", () => answer("still here"));
		setInvokeHandler("conv_save", () => {
			throw new Error("disk full");
		});
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("hello"));

		expect(result.current.phase).toBe("idle");
		expect(result.current.messages[result.current.messages.length - 1]?.text).toBe("still here");
	});

	it("shows the backend's error, and Retry sends the same message again without duplicating it", async () => {
		let attempts = 0;
		setInvokeHandler("ai_chat", () => {
			attempts += 1;
			if (attempts === 1)
				throw { kind: "rate-limited", message: "OpenRouter is limiting requests right now." };
			return answer("second time lucky");
		});
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("please help"));
		expect(result.current.phase).toBe("error");
		expect(result.current.error).toEqual({
			kind: "rate-limited",
			message: "OpenRouter is limiting requests right now."
		});

		await act(() => result.current.retry());

		expect(result.current.phase).toBe("idle");
		expect(result.current.messages.map((m) => m.text)).toEqual([
			"please help",
			"second time lucky"
		]);
	});

	it("shows progress sent by the backend while a reply is in flight", async () => {
		let finish: (value: unknown) => void = () => {};
		setInvokeHandler("ai_chat", () => new Promise((resolve) => (finish = resolve)));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		const { result } = renderHook(() => useAiSession());
		let sending: Promise<void> = Promise.resolve();
		act(() => {
			sending = result.current.send("what is on my screen?");
		});

		await waitFor(() => expect(result.current.phase).toBe("sending"));
		act(() => emitTauriEvent("ai-chat-status", "looking-at-screen"));
		expect(result.current.status).toBe("looking-at-screen");

		await act(async () => {
			finish(answer("a terminal"));
			await sending;
		});
		expect(result.current.status).toBeNull();
	});

	it("starts a new conversation on reset", async () => {
		setInvokeHandler("ai_chat", () => answer("an answer"));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		const { result } = renderHook(() => useAiSession());
		await act(() => result.current.send("hello"));
		const firstId = result.current.conversationId;

		act(() => result.current.reset());

		expect(result.current.messages).toEqual([]);
		expect(result.current.conversationId).not.toBe(firstId);
	});

	it("undoing a saved memory deletes it by its text and clears the notice", async () => {
		setInvokeHandler("ai_chat", () => ({
			...answer("Nice to meet you."),
			savedMemories: ["name is Tevin"]
		}));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: null }));
		setInvokeHandler("memory_list", () => [
			{ id: "m1", text: "likes tea", createdAt: 1 },
			{ id: "m2", text: "name is Tevin", createdAt: 2 }
		]);
		setInvokeHandler("memory_delete", () => ({ success: true }));
		const { result } = renderHook(() => useAiSession());
		await act(() => result.current.send("I am Tevin"));
		expect(result.current.notices).toEqual([{ kind: "memory", text: "name is Tevin" }]);

		await act(() => result.current.undoMemory("name is Tevin"));

		expect(callsTo("memory_delete")[0].args).toEqual({ id: "m2" });
		expect(result.current.notices).toEqual([]);
	});
});
