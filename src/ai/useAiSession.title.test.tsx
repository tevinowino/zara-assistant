import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setInvokeHandler } from "../test/shims/tauriCore";
import { useAiSession } from "./useAiSession";

const storedTrip = {
	id: "trip-1",
	title: "Trip planning",
	createdAt: 1,
	updatedAt: 2,
	messages: [{ id: "m1", role: "user", text: "Plan three days in Lisbon", createdAt: 1 }]
};

const reply = (text: string) => ({
	text,
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
});

describe("useAiSession title", () => {
	it("has no title for a brand new conversation", () => {
		setInvokeHandler("save_setting", () => null);

		const { result } = renderHook(() => useAiSession());

		expect(result.current.title).toBeNull();
	});

	it("takes the title of a past chat that is opened", async () => {
		setInvokeHandler("conv_load", () => storedTrip);
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.load("trip-1"));

		expect(result.current.title).toBe("Trip planning");
		expect(result.current.conversationId).toBe("trip-1");
	});

	it("takes the generated title once the first exchange has earned one", async () => {
		setInvokeHandler("save_setting", () => null);
		setInvokeHandler("ai_chat", () => reply("Day one: Alfama."));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler("conv_generate_title", () => ({ title: "Lisbon in three days" }));
		setInvokeHandler("conv_rename", () => ({ success: true }));
		const { result } = renderHook(() => useAiSession());

		await act(() => result.current.send("Plan three days in Lisbon"));

		await waitFor(() => expect(result.current.title).toBe("Lisbon in three days"));
	});

	it("forgets the title when a new conversation is started", async () => {
		setInvokeHandler("conv_load", () => storedTrip);
		setInvokeHandler("save_setting", () => null);
		const { result } = renderHook(() => useAiSession());
		await act(() => result.current.load("trip-1"));

		act(() => result.current.reset());

		expect(result.current.title).toBeNull();
	});

	it("does not give a late title to a conversation the user has already left", async () => {
		let releaseTitle: (value: { title: string }) => void = () => {};
		setInvokeHandler("save_setting", () => null);
		setInvokeHandler("ai_chat", () => reply("Day one: Alfama."));
		setInvokeHandler("conv_save", () => ({}));
		setInvokeHandler(
			"conv_generate_title",
			() => new Promise((resolve) => (releaseTitle = resolve))
		);
		setInvokeHandler("conv_rename", () => ({ success: true }));
		const { result } = renderHook(() => useAiSession());
		let sending: Promise<void> = Promise.resolve();
		await act(async () => {
			sending = result.current.send("Plan three days in Lisbon");
		});
		await waitFor(() => expect(result.current.messages).toHaveLength(2));

		act(() => result.current.reset());
		await act(async () => {
			releaseTitle({ title: "Lisbon in three days" });
			await sending;
		});

		expect(result.current.title).toBeNull();
	});
});
