import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { Note } from "../../ai/types";
import { useNotes } from "./useNotes";

const note = (id: string, text: string, updatedAt: number): Note => ({
	id,
	title: "",
	text,
	color: "yellow",
	createdAt: updatedAt,
	updatedAt
});

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("useNotes", () => {
	it("is empty until the notes have been read", () => {
		setInvokeHandler("note_list", () => new Promise(() => {}));

		const { result } = renderHook(() => useNotes());

		expect(result.current.notes).toBeNull();
		expect(result.current.failed).toBe(false);
	});

	it("lists the most recently changed note first", async () => {
		setInvokeHandler("note_list", () => [
			note("a", "oldest", 100),
			note("c", "newest", 300),
			note("b", "middle", 200)
		]);

		const { result } = renderHook(() => useNotes());

		await waitFor(() =>
			expect(result.current.notes?.map((n) => n.text)).toEqual(["newest", "middle", "oldest"])
		);
	});

	it("says so when the notes cannot be read", async () => {
		setInvokeHandler("note_list", () => {
			throw new Error("unreadable");
		});

		const { result } = renderHook(() => useNotes());

		await waitFor(() => expect(result.current.failed).toBe(true));
		expect(result.current.notes).toBeNull();
	});

	it("saves a new note trimmed, then shows what is stored", async () => {
		let stored = [note("a", "first", 100)];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_add", (args) => {
			const added = note("b", (args as { text: string }).text, 200);
			stored = [...stored, added];
			return added;
		});
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toHaveLength(1));

		let saved = false;
		await act(async () => {
			saved = await result.current.add("  buy milk  ");
		});

		expect(saved).toBe(true);
		expect(callsTo("note_add")[0].args).toMatchObject({ text: "buy milk" });
		expect(result.current.notes?.map((n) => n.text)).toEqual(["buy milk", "first"]);
	});

	it("does not save an empty note", async () => {
		setInvokeHandler("note_list", () => []);
		setInvokeHandler("note_add", () => null);
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toEqual([]));

		let saved = true;
		await act(async () => {
			saved = await result.current.add("   ");
		});

		expect(saved).toBe(false);
		expect(callsTo("note_add")).toHaveLength(0);
	});

	it("reports a note the store refused", async () => {
		setInvokeHandler("note_list", () => []);
		setInvokeHandler("note_add", () => null);
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toEqual([]));

		let saved = true;
		await act(async () => {
			saved = await result.current.add("something");
		});

		expect(saved).toBe(false);
	});

	it("reports a save that failed outright", async () => {
		setInvokeHandler("note_list", () => []);
		setInvokeHandler("note_add", () => {
			throw new Error("disk full");
		});
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toEqual([]));

		let saved = true;
		await act(async () => {
			saved = await result.current.add("something");
		});

		expect(saved).toBe(false);
	});

	it("replaces a note's text", async () => {
		let stored = [note("a", "before", 100)];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_update", (args) => {
			stored = [note("a", (args as { text: string }).text, 500)];
			return { success: true };
		});
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toHaveLength(1));

		let saved = false;
		await act(async () => {
			saved = await result.current.update("a", " after ");
		});

		expect(saved).toBe(true);
		expect(callsTo("note_update")[0].args).toMatchObject({ id: "a", text: "after" });
		expect(result.current.notes?.[0].text).toBe("after");
	});

	it("does not replace a note with nothing", async () => {
		setInvokeHandler("note_list", () => [note("a", "keep", 100)]);
		setInvokeHandler("note_update", () => ({ success: true }));
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toHaveLength(1));

		let saved = true;
		await act(async () => {
			saved = await result.current.update("a", "  ");
		});

		expect(saved).toBe(false);
		expect(callsTo("note_update")).toHaveLength(0);
	});

	it("deletes a note and shows the list without it", async () => {
		let stored = [note("a", "one", 100), note("b", "two", 200)];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_delete", (args) => {
			stored = stored.filter((n) => n.id !== (args as { id: string }).id);
			return { success: true };
		});
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toHaveLength(2));

		await act(async () => {
			await result.current.remove("b");
		});

		expect(result.current.notes?.map((n) => n.id)).toEqual(["a"]);
	});

	it("reads the list again after a failed delete so what is shown is what is stored", async () => {
		setInvokeHandler("note_list", () => [note("a", "one", 100)]);
		setInvokeHandler("note_delete", () => {
			throw new Error("locked");
		});
		const { result } = renderHook(() => useNotes());
		await waitFor(() => expect(result.current.notes).toHaveLength(1));
		const readsBefore = callsTo("note_list").length;

		await act(async () => {
			await result.current.remove("a");
		});

		expect(callsTo("note_list").length).toBeGreaterThan(readsBefore);
		expect(result.current.notes).toHaveLength(1);
	});
});
