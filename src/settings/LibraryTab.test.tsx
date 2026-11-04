import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LibraryTab, OPEN_CONVERSATION_EVENT } from "./LibraryTab";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { listen } from "@tauri-apps/api/event";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import type { ConversationSummary, MemoryEntry, Note } from "../ai/types";

const note = (overrides: Partial<Note> = {}): Note => ({
	id: "n1",
	title: "Shopping",
	text: "Milk and eggs",
	color: "blue",
	createdAt: 1,
	updatedAt: 1,
	...overrides
});

function backend({
	notes = [] as Note[],
	memories = [] as MemoryEntry[],
	conversations = [] as ConversationSummary[],
	legacy = { available: false, notes: 0, conversations: 0, memories: 0 }
} = {}) {
	setInvokeHandler("note_list", () => notes);
	setInvokeHandler("memory_list", () => memories);
	setInvokeHandler("conv_list", () => conversations);
	setInvokeHandler("legacy_import_status", () => legacy);
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("notes", () => {
	it("shows saved notes with their titles and text", async () => {
		backend({ notes: [note()] });

		render(<LibraryTab />);

		expect(await screen.findByText("Shopping")).toBeInTheDocument();
		expect(screen.getByText("Milk and eggs")).toBeInTheDocument();
	});

	it("says when there are none", async () => {
		backend();

		render(<LibraryTab />);

		expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
	});

	it("adds a note on Enter and shows the refreshed list", async () => {
		let stored: Note[] = [];
		backend();
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_add", (args) => {
			stored = [note({ id: "n2", title: "Call mum", text: String(args?.text) })];
			return stored[0];
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("New note"), "Call mum{Enter}");

		expect(await screen.findByText("Call mum", { selector: "strong" })).toBeInTheDocument();
		expect(calls("note_add")[0].args).toMatchObject({ text: "Call mum" });
		expect(screen.getByLabelText("New note")).toHaveValue("");
	});

	it("does not add a blank note", async () => {
		backend();
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("New note"), "   {Enter}");

		expect(calls("note_add")).toHaveLength(0);
	});

	it("edits a note's text", async () => {
		let stored = [note()];
		backend({ notes: stored });
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_update", (args) => {
			stored = [note({ text: String(args?.text) })];
			return { success: true };
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Edit note Shopping" }));
		const box = screen.getByRole("textbox", { name: "Edit note Shopping" });
		await user.clear(box);
		await user.type(box, "Milk, eggs and bread");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Milk, eggs and bread")).toBeInTheDocument();
		expect(calls("note_update")[0].args).toMatchObject({ id: "n1", text: "Milk, eggs and bread" });
	});

	it("deletes a note", async () => {
		let stored = [note()];
		backend();
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_delete", () => {
			stored = [];
			return { success: true };
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Delete note Shopping" }));

		expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
		expect(calls("note_delete")[0].args).toEqual({ id: "n1" });
	});

	it("refreshes when the assistant adds a note while Settings is open", async () => {
		let stored: Note[] = [];
		backend();
		setInvokeHandler("note_list", () => stored);
		render(<LibraryTab />);
		await screen.findByText("No notes yet.");

		stored = [note({ title: "Added by Zara" })];
		emitTauriEvent("ai-notes-changed");

		expect(await screen.findByText("Added by Zara")).toBeInTheDocument();
	});
});

describe("memory", () => {
	it("lists what Zara remembers and lets the user forget a fact", async () => {
		let stored: MemoryEntry[] = [{ id: "m1", text: "prefers concise answers", createdAt: 1 }];
		backend();
		setInvokeHandler("memory_list", () => stored);
		setInvokeHandler("memory_delete", () => {
			stored = [];
			return { success: true };
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Forget prefers concise answers" }));

		expect(await screen.findByText(/has not saved anything about you/)).toBeInTheDocument();
		expect(calls("memory_delete")[0].args).toEqual({ id: "m1" });
	});

	it("saves a fact the user types", async () => {
		backend();
		setInvokeHandler("memory_add", () => ({ id: "m9", text: "likes tea", createdAt: 2 }));
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("New memory"), "likes tea{Enter}");

		expect(calls("memory_add")[0].args).toEqual({ text: "likes tea" });
	});
});

describe("conversations", () => {
	const conversation: ConversationSummary = {
		id: "c1",
		title: "Brewing tea",
		updatedAt: 1_700_000_000_000
	};

	it("opens a saved conversation in the notch by sending an event to the other window", async () => {
		backend({ conversations: [conversation] });
		const received: unknown[] = [];
		await listen(OPEN_CONVERSATION_EVENT, (event) => received.push(event.payload));
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Open Brewing tea" }));

		expect(received).toEqual(["c1"]);
	});

	it("deletes a saved conversation", async () => {
		let stored = [conversation];
		backend();
		setInvokeHandler("conv_list", () => stored);
		setInvokeHandler("conv_delete", () => {
			stored = [];
			return { success: true };
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Delete Brewing tea" }));

		expect(await screen.findByText("No saved conversations yet.")).toBeInTheDocument();
	});
});

describe("importing from the previous Zara", () => {
	const legacy = { available: true, notes: 12, conversations: 4, memories: 3 };

	it("offers to import and says what it found and that the old files are not changed", async () => {
		backend({ legacy });

		render(<LibraryTab />);

		expect(await screen.findByText("Import from your previous Zara")).toBeInTheDocument();
		expect(screen.getByText(/Found 12 notes, 4 conversations and 3 memories/)).toBeInTheDocument();
		expect(screen.getByText(/the old files are not changed/)).toBeInTheDocument();
	});

	it("does not offer when there is nothing to import", async () => {
		backend();

		render(<LibraryTab />);
		await screen.findByText("No notes yet.");

		expect(screen.queryByText("Import from your previous Zara")).not.toBeInTheDocument();
	});

	it("imports on request and reports the counts", async () => {
		backend({ legacy });
		setInvokeHandler("legacy_import_run", () => ({ notes: 12, conversations: 1, memories: 3 }));
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Import" }));

		expect(
			await screen.findByText("Imported 12 notes, 1 conversation, 3 memories.")
		).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByText("Import from your previous Zara")).not.toBeInTheDocument()
		);
	});

	it("stops offering when the user declines", async () => {
		backend({ legacy });
		setInvokeHandler("legacy_import_dismiss", () => undefined);
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Not now" }));

		await waitFor(() =>
			expect(screen.queryByText("Import from your previous Zara")).not.toBeInTheDocument()
		);
		expect(calls("legacy_import_dismiss")).toHaveLength(1);
		expect(calls("legacy_import_run")).toHaveLength(0);
	});

	it("shows an error instead of failing silently when the import cannot run", async () => {
		backend({ legacy });
		setInvokeHandler("legacy_import_run", () => {
			throw "No earlier Zara data was found.";
		});
		render(<LibraryTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Import" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("No earlier Zara data was found.");
	});
});
