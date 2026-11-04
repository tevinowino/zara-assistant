import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipboardPanel } from "./ClipboardPanel";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { ClipboardEntry } from "../clipboard/useClipboardHistory";

const writeText = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;
const entry = (id: number, text: string, copiedAt = minutesAgo(5)): ClipboardEntry => ({
	id,
	text,
	copiedAt
});
const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("ClipboardPanel", () => {
	beforeEach(() => {
		writeText.mockReset();
		writeText.mockResolvedValue(undefined);
	});

	it("is not drawn on another panel", () => {
		setInvokeHandler("clipboard_history_list", () => []);

		render(<ClipboardPanel zaraMode="calendar" />);

		expect(screen.queryByRole("heading", { name: "Clipboard" })).not.toBeInTheDocument();
	});

	it("invites the first copy when there is nothing yet", async () => {
		setInvokeHandler("clipboard_history_list", () => []);

		render(<ClipboardPanel zaraMode="clipboard" />);

		expect(await screen.findByText("Copy something and it will show up here.")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
	});

	it("says when the history cannot be loaded", async () => {
		setInvokeHandler("clipboard_history_list", () => {
			throw new Error("unavailable");
		});

		render(<ClipboardPanel zaraMode="clipboard" />);

		expect(
			await screen.findByText("The clipboard history could not be loaded.")
		).toBeInTheDocument();
	});

	it("lists what was copied with how long ago", async () => {
		setInvokeHandler("clipboard_history_list", () => [
			entry(2, "https://example.com", minutesAgo(2)),
			entry(1, "an earlier thing", minutesAgo(45))
		]);

		render(<ClipboardPanel zaraMode="clipboard" />);

		const list = await screen.findByRole("list", { name: "Copied items" });
		const items = list.querySelectorAll("li");
		expect(items[0]).toHaveTextContent("https://example.com");
		expect(items[0]).toHaveTextContent("2 min ago");
		expect(items[1]).toHaveTextContent("an earlier thing");
		expect(items[1]).toHaveTextContent("45 min ago");
	});

	it("says what is and is not remembered", async () => {
		setInvokeHandler("clipboard_history_list", () => []);

		render(<ClipboardPanel zaraMode="clipboard" />);

		expect(
			await screen.findByText(
				"Text only, kept in memory until Zara quits. Copies from password managers are skipped."
			)
		).toBeInTheDocument();
	});

	it("copies an item again when it is clicked, and says so", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(1, "copy me")]);
		render(<ClipboardPanel zaraMode="clipboard" />);
		const user = userEvent.setup();

		await user.click(await screen.findByText("copy me"));

		expect(writeText).toHaveBeenCalledWith("copy me");
		expect(await screen.findByRole("status")).toHaveTextContent("Copied");
	});

	it("does not say Copied when the copy did not work", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(1, "copy me")]);
		writeText.mockRejectedValue(new Error("denied"));
		render(<ClipboardPanel zaraMode="clipboard" />);
		const user = userEvent.setup();

		await user.click(await screen.findByText("copy me"));

		await waitFor(() => expect(writeText).toHaveBeenCalled());
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("removes one item", async () => {
		let stored = [entry(2, "keep"), entry(1, "drop")];
		setInvokeHandler("clipboard_history_list", () => stored);
		setInvokeHandler("clipboard_history_remove", (args) => {
			stored = stored.filter((e) => e.id !== (args as { id: number }).id);
			return null;
		});
		render(<ClipboardPanel zaraMode="clipboard" />);
		const user = userEvent.setup();
		await screen.findByText("drop");

		await user.click(screen.getByRole("button", { name: "Remove from history: drop" }));

		await waitFor(() => expect(screen.queryByText("drop")).not.toBeInTheDocument());
		expect(screen.getByText("keep")).toBeInTheDocument();
		expect(callsTo("clipboard_history_remove")[0].args).toEqual({ id: 1 });
	});

	it("names each remove button for its item", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(2, "alpha"), entry(1, "beta")]);

		render(<ClipboardPanel zaraMode="clipboard" />);

		expect(
			await screen.findByRole("button", { name: "Remove from history: alpha" })
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove from history: beta" })).toBeInTheDocument();
	});

	it("clears everything", async () => {
		let stored = [entry(2, "b"), entry(1, "a")];
		setInvokeHandler("clipboard_history_list", () => stored);
		setInvokeHandler("clipboard_history_clear", () => {
			stored = [];
			return null;
		});
		render(<ClipboardPanel zaraMode="clipboard" />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Clear all" }));

		expect(await screen.findByText("Copy something and it will show up here.")).toBeInTheDocument();
	});

	it("keeps clicks inside from reaching the notch, which would switch its mode", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(1, "text")]);
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<ClipboardPanel zaraMode="clipboard" />
			</div>
		);
		const user = userEvent.setup();

		await user.click(await screen.findByText("text"));

		expect(notchClick).not.toHaveBeenCalled();
	});
});
