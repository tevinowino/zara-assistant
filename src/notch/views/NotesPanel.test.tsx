import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesPanel } from "./NotesPanel";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { Note } from "../../ai/types";

const hoursAgo = (hours: number) => Date.now() - hours * 3_600_000;
const note = (id: string, text: string, updatedAt: number, title = ""): Note => ({
	id,
	title,
	text,
	color: "yellow",
	createdAt: updatedAt,
	updatedAt
});
const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

function renderNotes(onFieldFocusChange = vi.fn(), zaraMode: "notes" | "calendar" = "notes") {
	render(<NotesPanel zaraMode={zaraMode} onFieldFocusChange={onFieldFocusChange} />);
	return onFieldFocusChange;
}

describe("NotesPanel", () => {
	it("is not drawn on another panel", () => {
		setInvokeHandler("note_list", () => []);

		renderNotes(vi.fn(), "calendar");

		expect(screen.queryByLabelText("New note")).not.toBeInTheDocument();
	});

	it("invites the first note when there are none", async () => {
		setInvokeHandler("note_list", () => []);

		renderNotes();

		expect(await screen.findByText("No notes yet. Type one above.")).toBeInTheDocument();
		expect(screen.getByLabelText("New note")).toBeInTheDocument();
	});

	it("says when the notes cannot be loaded", async () => {
		setInvokeHandler("note_list", () => {
			throw new Error("unreadable");
		});

		renderNotes();

		expect(await screen.findByText("Notes could not be loaded.")).toBeInTheDocument();
	});

	it("lists the notes, the most recent first, with how long ago each was written", async () => {
		setInvokeHandler("note_list", () => [
			note("a", "older note", hoursAgo(5)),
			note("b", "newer note", hoursAgo(2))
		]);

		renderNotes();

		const list = await screen.findByRole("list", { name: "Notes" });
		const items = list.querySelectorAll("li");
		expect(items[0]).toHaveTextContent("newer note");
		expect(items[0]).toHaveTextContent("2 h ago");
		expect(items[1]).toHaveTextContent("older note");
		expect(items[1]).toHaveTextContent("5 h ago");
	});

	it("shows a note's title above its text", async () => {
		setInvokeHandler("note_list", () => [note("a", "milk and eggs", hoursAgo(1), "Shopping")]);

		renderNotes();

		expect(await screen.findByText("Shopping")).toBeInTheDocument();
		expect(screen.getByText("milk and eggs")).toBeInTheDocument();
	});

	it("cannot add an empty note", async () => {
		setInvokeHandler("note_list", () => []);
		renderNotes();
		await screen.findByText("No notes yet. Type one above.");

		expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
	});

	it("adds a note when Enter is pressed, clears the field, and shows the note", async () => {
		let stored: Note[] = [];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_add", (args) => {
			const added = note("n1", (args as { text: string }).text, Date.now());
			stored = [added];
			return added;
		});
		renderNotes();
		const user = userEvent.setup();
		await screen.findByText("No notes yet. Type one above.");

		await user.type(screen.getByLabelText("New note"), "call the bank{Enter}");

		expect(await screen.findByText("call the bank")).toBeInTheDocument();
		expect(callsTo("note_add")[0].args).toMatchObject({ text: "call the bank" });
		expect(screen.getByLabelText("New note")).toHaveValue("");
	});

	it("adds a note from the add button", async () => {
		let stored: Note[] = [];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_add", (args) => {
			stored = [note("n1", (args as { text: string }).text, Date.now())];
			return stored[0];
		});
		renderNotes();
		const user = userEvent.setup();
		await screen.findByText("No notes yet. Type one above.");

		await user.type(screen.getByLabelText("New note"), "water the plants");
		await user.click(screen.getByRole("button", { name: "Add note" }));

		expect(await screen.findByText("water the plants")).toBeInTheDocument();
	});

	it("keeps what was typed when the note could not be saved", async () => {
		setInvokeHandler("note_list", () => []);
		setInvokeHandler("note_add", () => null);
		renderNotes();
		const user = userEvent.setup();
		await screen.findByText("No notes yet. Type one above.");

		await user.type(screen.getByLabelText("New note"), "do not lose me{Enter}");

		await waitFor(() => expect(callsTo("note_add")).toHaveLength(1));
		await waitFor(() => expect(screen.getByLabelText("New note")).toHaveValue("do not lose me"));
	});

	it("opens a note for editing when it is clicked", async () => {
		setInvokeHandler("note_list", () => [note("a", "first draft", hoursAgo(1))]);
		renderNotes();
		const user = userEvent.setup();

		await user.click(await screen.findByText("first draft"));

		expect(screen.getByLabelText("Edit note")).toHaveValue("first draft");
	});

	it("saves an edit on Enter", async () => {
		let stored = [note("a", "first draft", hoursAgo(1))];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_update", (args) => {
			stored = [note("a", (args as { text: string }).text, Date.now())];
			return { success: true };
		});
		renderNotes();
		const user = userEvent.setup();
		await user.click(await screen.findByText("first draft"));

		const field = screen.getByLabelText("Edit note");
		await user.clear(field);
		await user.type(field, "final draft{Enter}");

		expect(await screen.findByText("final draft")).toBeInTheDocument();
		expect(callsTo("note_update")[0].args).toMatchObject({ id: "a", text: "final draft" });
		expect(screen.queryByLabelText("Edit note")).not.toBeInTheDocument();
	});

	it("saves an edit when the field loses the caret", async () => {
		let stored = [note("a", "first draft", hoursAgo(1))];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_update", (args) => {
			stored = [note("a", (args as { text: string }).text, Date.now())];
			return { success: true };
		});
		renderNotes();
		const user = userEvent.setup();
		await user.click(await screen.findByText("first draft"));

		await user.type(screen.getByLabelText("Edit note"), " plus more");
		await user.click(screen.getByLabelText("New note"));

		await waitFor(() => expect(callsTo("note_update")).toHaveLength(1));
		expect(callsTo("note_update")[0].args).toMatchObject({ text: "first draft plus more" });
	});

	it("discards an edit on Escape", async () => {
		setInvokeHandler("note_list", () => [note("a", "keep this", hoursAgo(1))]);
		setInvokeHandler("note_update", () => ({ success: true }));
		renderNotes();
		const user = userEvent.setup();
		await user.click(await screen.findByText("keep this"));

		await user.type(screen.getByLabelText("Edit note"), " oops{Escape}");

		expect(screen.queryByLabelText("Edit note")).not.toBeInTheDocument();
		expect(screen.getByText("keep this")).toBeInTheDocument();
		expect(callsTo("note_update")).toHaveLength(0);
	});

	it("does not save an edit that changed nothing", async () => {
		setInvokeHandler("note_list", () => [note("a", "same", hoursAgo(1))]);
		setInvokeHandler("note_update", () => ({ success: true }));
		renderNotes();
		const user = userEvent.setup();
		await user.click(await screen.findByText("same"));

		await user.type(screen.getByLabelText("Edit note"), "{Enter}");

		expect(callsTo("note_update")).toHaveLength(0);
	});

	it("saves an edit only once", async () => {
		let stored = [note("a", "one", hoursAgo(1))];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_update", (args) => {
			stored = [note("a", (args as { text: string }).text, Date.now())];
			return { success: true };
		});
		renderNotes();
		const user = userEvent.setup();
		await user.click(await screen.findByText("one"));

		await user.type(screen.getByLabelText("Edit note"), " two{Enter}");
		await screen.findByText("one two");

		expect(callsTo("note_update")).toHaveLength(1);
	});

	it("deletes a note", async () => {
		let stored = [note("a", "gone soon", hoursAgo(1)), note("b", "stays", hoursAgo(3))];
		setInvokeHandler("note_list", () => stored);
		setInvokeHandler("note_delete", (args) => {
			stored = stored.filter((n) => n.id !== (args as { id: string }).id);
			return { success: true };
		});
		renderNotes();
		const user = userEvent.setup();
		await screen.findByText("gone soon");

		await user.click(screen.getByRole("button", { name: "Delete note: gone soon" }));

		await waitFor(() => expect(screen.queryByText("gone soon")).not.toBeInTheDocument());
		expect(screen.getByText("stays")).toBeInTheDocument();
		expect(callsTo("note_delete")[0].args).toEqual({ id: "a" });
	});

	it("names each delete button for its note", async () => {
		setInvokeHandler("note_list", () => [
			note("a", "alpha", hoursAgo(1)),
			note("b", "beta", hoursAgo(2))
		]);
		renderNotes();

		expect(await screen.findByRole("button", { name: "Delete note: alpha" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete note: beta" })).toBeInTheDocument();
	});

	it("tells the notch when the new-note field has the caret", async () => {
		setInvokeHandler("note_list", () => []);
		const onFieldFocusChange = renderNotes();
		const user = userEvent.setup();
		await screen.findByText("No notes yet. Type one above.");

		await user.click(screen.getByLabelText("New note"));
		expect(onFieldFocusChange).toHaveBeenLastCalledWith(true);

		await user.tab();
		expect(onFieldFocusChange).toHaveBeenLastCalledWith(false);
	});

	it("tells the notch about the caret while a note is edited, and when it leaves", async () => {
		setInvokeHandler("note_list", () => [note("a", "text", hoursAgo(1))]);
		setInvokeHandler("note_update", () => ({ success: true }));
		const onFieldFocusChange = renderNotes();
		const user = userEvent.setup();

		await user.click(await screen.findByText("text"));
		expect(onFieldFocusChange).toHaveBeenLastCalledWith(true);

		await user.type(screen.getByLabelText("Edit note"), "{Escape}");
		await waitFor(() => expect(onFieldFocusChange).toHaveBeenLastCalledWith(false));
	});

	it("tells the notch the caret is gone if the panel closes while a field has it", async () => {
		setInvokeHandler("note_list", () => []);
		const onFieldFocusChange = vi.fn();
		const { rerender } = render(
			<NotesPanel zaraMode="notes" onFieldFocusChange={onFieldFocusChange} />
		);
		const user = userEvent.setup();
		await screen.findByText("No notes yet. Type one above.");
		await user.click(screen.getByLabelText("New note"));
		onFieldFocusChange.mockClear();

		rerender(<NotesPanel zaraMode="calendar" onFieldFocusChange={onFieldFocusChange} />);

		await waitFor(() => expect(onFieldFocusChange).toHaveBeenCalledWith(false));
	});

	it("keeps clicks inside from reaching the notch, which would switch its mode", async () => {
		setInvokeHandler("note_list", () => []);
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<NotesPanel zaraMode="notes" onFieldFocusChange={() => {}} />
			</div>
		);
		const user = userEvent.setup();

		await user.click(await screen.findByLabelText("New note"));

		expect(notchClick).not.toHaveBeenCalled();
	});
});
