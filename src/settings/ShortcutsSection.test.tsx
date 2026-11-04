import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShortcutsSection } from "./ShortcutsSection";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import type { ShortcutRow } from "../ai/api";

const toggleRow = (overrides: Partial<ShortcutRow> = {}): ShortcutRow => ({
	action: "ai.toggle",
	label: "Show or hide Zara",
	scope: "global",
	default: "Ctrl+Shift+Space",
	preferred: null,
	active: "Ctrl+Shift+Space",
	message: null,
	...overrides
});

const resetRow = (overrides: Partial<ShortcutRow> = {}): ShortcutRow => ({
	action: "ai.reset",
	label: "Start a new conversation",
	scope: "panel",
	default: "Ctrl+R",
	preferred: null,
	active: "Ctrl+R",
	message: null,
	...overrides
});

function press(
	code: string,
	modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}
) {
	fireEvent.keyDown(window, { code, ...modifiers });
}

describe("ShortcutsSection", () => {
	it("lists every shortcut with what is in effect and where it works", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow(), resetRow()]);

		render(<ShortcutsSection />);

		expect(await screen.findByText("Show or hide Zara")).toBeInTheDocument();
		expect(screen.getByText("Works in any app")).toBeInTheDocument();
		expect(screen.getByText("Works while the Zara panel is open")).toBeInTheDocument();
		expect(screen.getByText("Space")).toBeInTheDocument();
	});

	it("records the next key combination and applies it", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow()]);
		setInvokeHandler("shortcut_set", (args) =>
			toggleRow({ preferred: args?.accelerator as string, active: args?.accelerator as string })
		);
		render(<ShortcutsSection />);
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Change shortcut for Show or hide Zara" })
		);
		expect(screen.getByText("Press keys…")).toBeInTheDocument();
		press("KeyQ", { ctrlKey: true, altKey: true });

		await waitFor(() => expect(screen.getByText("Q")).toBeInTheDocument());
		expect(invokeCalls.find((c) => c.command === "shortcut_set")?.args).toEqual({
			action: "ai.toggle",
			accelerator: "Ctrl+Alt+Q"
		});
		expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
	});

	it("keeps waiting while only modifier keys are held", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow()]);
		render(<ShortcutsSection />);
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", { name: "Change shortcut for Show or hide Zara" })
		);

		press("ControlLeft", { ctrlKey: true });

		expect(screen.getByText("Press keys…")).toBeInTheDocument();
		expect(invokeCalls.some((c) => c.command === "shortcut_set")).toBe(false);
	});

	it("cancels recording on Escape without changing anything", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow()]);
		render(<ShortcutsSection />);
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", { name: "Change shortcut for Show or hide Zara" })
		);

		press("Escape");

		await waitFor(() => expect(screen.queryByText("Press keys…")).not.toBeInTheDocument());
		expect(invokeCalls.some((c) => c.command === "shortcut_set")).toBe(false);
	});

	it("explains an unavailable choice and shows the shortcut Zara is using instead", async () => {
		const message =
			"Ctrl+Shift+K isn't available. Windows or another application is using it, so it may not work while you're in that app. Zara is using Ctrl+Shift+Space instead. You can pick a different shortcut.";
		setInvokeHandler("shortcut_list", () => [toggleRow()]);
		setInvokeHandler("shortcut_set", () =>
			toggleRow({ preferred: "Ctrl+Shift+K", active: "Ctrl+Shift+Space", message })
		);
		render(<ShortcutsSection />);
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Change shortcut for Show or hide Zara" })
		);
		press("KeyK", { ctrlKey: true, shiftKey: true });

		expect(await screen.findByText(message)).toBeInTheDocument();
		expect(screen.getByText("Space")).toBeInTheDocument();
	});

	it("shows the explanation from the start when a shortcut could not be used at launch", async () => {
		setInvokeHandler("shortcut_list", () => [
			toggleRow({
				message:
					"Ctrl+Shift+Space isn't available. Windows or another application is using it, so it may not work while you're in that app. Zara is using Ctrl+Alt+Space instead. You can pick a different shortcut.",
				active: "Ctrl+Alt+Space"
			})
		]);

		render(<ShortcutsSection />);

		expect(await screen.findByRole("alert")).toHaveTextContent("isn't available");
	});

	it("says so when no shortcut could be used, without breaking the row", async () => {
		setInvokeHandler("shortcut_list", () => [
			toggleRow({
				active: null,
				message:
					'No shortcut is set for "Show or hide Zara" right now; you can still click the notch.'
			})
		]);

		render(<ShortcutsSection />);

		expect(await screen.findByText("Not set")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("you can still click the notch");
	});

	it("resets a changed shortcut to its default", async () => {
		setInvokeHandler("shortcut_list", () => [
			toggleRow({ preferred: "Ctrl+Alt+Q", active: "Ctrl+Alt+Q" })
		]);
		setInvokeHandler("shortcut_reset", () => toggleRow());
		render(<ShortcutsSection />);
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Reset shortcut for Show or hide Zara" })
		);

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: /Reset shortcut/ })).not.toBeInTheDocument()
		);
		expect(invokeCalls.find((c) => c.command === "shortcut_reset")?.args).toEqual({
			action: "ai.toggle"
		});
	});

	it("always warns where a global shortcut may not work", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow()]);

		render(<ShortcutsSection />);

		expect(await screen.findByText(/application running as administrator/)).toBeInTheDocument();
	});

	it("shows a backend error instead of failing silently", async () => {
		setInvokeHandler("shortcut_list", () => [toggleRow()]);
		setInvokeHandler("shortcut_set", () => {
			throw '"Ctrl+Banana" is not a key.';
		});
		render(<ShortcutsSection />);
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Change shortcut for Show or hide Zara" })
		);
		press("KeyK", { ctrlKey: true });

		expect(await screen.findByRole("alert")).toHaveTextContent("is not a key");
	});
});
