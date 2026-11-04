import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { useAiSession } from "./useAiSession";

const LAST_CONVERSATION_KEY = "zara-ai-last-conversation";

const storedTrip = {
	id: "trip-1",
	title: "Trip planning",
	createdAt: 1,
	updatedAt: 2,
	messages: [
		{ id: "m1", role: "user", text: "Plan three days in Lisbon", createdAt: 1 },
		{ id: "m2", role: "assistant", text: "Day one: Alfama.", createdAt: 2 }
	]
};

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("useAiSession resuming the last conversation", () => {
	it("opens the conversation the user left off in and says which one it is", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: true }));

		await waitFor(() => expect(result.current.messages).toHaveLength(2));
		expect(result.current.conversationId).toBe("trip-1");
		expect(result.current.resumedTitle).toBe("Trip planning");
		expect(callsTo("conv_load")[0].args).toEqual({ id: "trip-1" });
	});

	it("starts fresh when resuming is turned off", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: false }));
		await waitFor(() => expect(callsTo("save_setting")).toHaveLength(1));

		expect(result.current.messages).toEqual([]);
		expect(result.current.resumedTitle).toBeNull();
		expect(callsTo("conv_load")).toHaveLength(0);
	});

	it("starts fresh when nothing was saved before", async () => {
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: true }));
		await waitFor(() => expect(callsTo("save_setting")).toHaveLength(1));

		expect(result.current.messages).toEqual([]);
		expect(callsTo("conv_load")).toHaveLength(0);
	});

	it("starts fresh and remembers the new conversation when the saved one is gone", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "deleted-1");
		setInvokeHandler("conv_load", () => null);
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: true }));

		await waitFor(() => expect(callsTo("save_setting")).toHaveLength(1));
		expect(result.current.messages).toEqual([]);
		expect(result.current.resumedTitle).toBeNull();
		expect(callsTo("save_setting")[0].args).toEqual({
			key: LAST_CONVERSATION_KEY,
			value: result.current.conversationId
		});
		expect(result.current.conversationId).not.toBe("deleted-1");
	});

	it("starts fresh when the saved conversation has no messages", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "empty-1");
		setInvokeHandler("conv_load", () => ({ ...storedTrip, id: "empty-1", messages: [] }));
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: true }));
		await waitFor(() => expect(callsTo("save_setting")).toHaveLength(1));

		expect(result.current.messages).toEqual([]);
		expect(result.current.resumedTitle).toBeNull();
	});

	it("starts fresh when the saved conversation cannot be read", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "broken-1");
		setInvokeHandler("conv_load", () => {
			throw new Error("disk error");
		});
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession({ resumeLast: true }));
		await waitFor(() => expect(callsTo("save_setting")).toHaveLength(1));

		expect(result.current.messages).toEqual([]);
	});

	it("remembers the new conversation id after the user starts a new conversation", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);
		const { result } = renderHook(() => useAiSession({ resumeLast: true }));
		await waitFor(() => expect(result.current.messages).toHaveLength(2));

		act(() => result.current.reset());

		await waitFor(() =>
			expect(callsTo("save_setting").at(-1)?.args).toEqual({
				key: LAST_CONVERSATION_KEY,
				value: result.current.conversationId
			})
		);
		expect(result.current.conversationId).not.toBe("trip-1");
		expect(result.current.resumedTitle).toBeNull();
		expect(localStorage.getItem(LAST_CONVERSATION_KEY)).toBe(result.current.conversationId);
	});

	it("stops saying it is continuing once the user sends a message", async () => {
		localStorage.setItem(LAST_CONVERSATION_KEY, "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);
		setInvokeHandler("ai_chat", () => ({
			text: "Day two: Sintra.",
			usedScreen: false,
			usedNotes: false,
			savedMemories: [],
			noteChanges: []
		}));
		setInvokeHandler("conv_save", () => ({}));
		const { result } = renderHook(() => useAiSession({ resumeLast: true }));
		await waitFor(() => expect(result.current.resumedTitle).toBe("Trip planning"));

		await act(() => result.current.send("And day two?"));

		expect(result.current.resumedTitle).toBeNull();
		expect(result.current.messages).toHaveLength(4);
	});

	it("keeps an unsent draft", () => {
		const { result } = renderHook(() => useAiSession());

		act(() => result.current.setDraft("what time is it in Lis"));

		expect(result.current.draft).toBe("what time is it in Lis");
	});
});
