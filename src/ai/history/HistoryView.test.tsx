import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";

const now = Date.now();
const minutesAgo = (minutes: number) => now - minutes * 60_000;

function renderHistory(overrides: Partial<Parameters<typeof HistoryView>[0]> = {}) {
	const props = {
		currentId: "none",
		busy: false,
		onOpen: vi.fn(),
		onDeleted: vi.fn(),
		onBack: vi.fn(),
		onNew: vi.fn(),
		...overrides
	};
	render(<HistoryView {...props} />);
	return props;
}

describe("HistoryView", () => {
	it("lists past chats by title with when they were last used", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) },
			{ id: "c2", title: "Notes cleanup", updatedAt: minutesAgo(2 * 24 * 60) }
		]);

		renderHistory();

		expect(await screen.findByRole("button", { name: "Open Trip planning" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Open Notes cleanup" })).toBeInTheDocument();
		expect(screen.getByText("5 min ago")).toBeInTheDocument();
		expect(screen.getByText("Today")).toBeInTheDocument();
	});

	it("opens the chat the user clicks", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) }
		]);
		const props = renderHistory();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Open Trip planning" }));

		expect(props.onOpen).toHaveBeenCalledWith("c1");
	});

	it("marks the chat that is already open", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) },
			{ id: "c2", title: "Notes cleanup", updatedAt: minutesAgo(60) }
		]);

		renderHistory({ currentId: "c1" });

		const current = await screen.findByRole("button", { name: "Open Trip planning" });
		expect(current).toHaveAttribute("aria-current", "true");
		expect(screen.getByRole("button", { name: "Open Notes cleanup" })).not.toHaveAttribute(
			"aria-current"
		);
	});

	it("does not open another chat while an answer is still being written", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) }
		]);

		renderHistory({ busy: true });

		expect(await screen.findByRole("button", { name: "Open Trip planning" })).toBeDisabled();
	});

	it("deletes a chat only after a second confirming click", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) },
			{ id: "c2", title: "Notes cleanup", updatedAt: minutesAgo(60) }
		]);
		setInvokeHandler("conv_delete", () => ({ success: true }));
		const props = renderHistory();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Delete Trip planning" }));
		expect(invokeCalls.filter((call) => call.command === "conv_delete")).toHaveLength(0);

		await user.click(screen.getByRole("button", { name: "Confirm delete Trip planning" }));

		expect(invokeCalls.filter((call) => call.command === "conv_delete")[0].args).toEqual({
			id: "c1"
		});
		expect(screen.queryByRole("button", { name: "Open Trip planning" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Open Notes cleanup" })).toBeInTheDocument();
		expect(props.onDeleted).toHaveBeenCalledWith("c1");
	});

	it("shows a friendly line when there are no past chats", async () => {
		setInvokeHandler("conv_list", () => []);

		renderHistory();

		expect(await screen.findByText("No past chats yet.")).toBeInTheDocument();
	});

	it("says so and offers a retry when the chats cannot be loaded", async () => {
		let attempts = 0;
		setInvokeHandler("conv_list", () => {
			attempts += 1;
			if (attempts === 1) throw new Error("disk error");
			return [{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) }];
		});
		renderHistory();
		const user = userEvent.setup();

		expect(await screen.findByText("Couldn't load your chats.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Try again" }));

		expect(await screen.findByRole("button", { name: "Open Trip planning" })).toBeInTheDocument();
	});

	it("gives a chat with no title a readable name", async () => {
		setInvokeHandler("conv_list", () => [{ id: "c1", title: "", updatedAt: minutesAgo(5) }]);

		renderHistory();

		expect(await screen.findByRole("button", { name: "Open Untitled chat" })).toBeInTheDocument();
	});

	it("goes back to the chat and starts a new one from its toolbar", async () => {
		setInvokeHandler("conv_list", () => []);
		const props = renderHistory();
		const user = userEvent.setup();
		await screen.findByText("No past chats yet.");

		await user.click(screen.getByRole("button", { name: "Back to chat" }));
		await user.click(screen.getByRole("button", { name: "New chat" }));

		expect(props.onBack).toHaveBeenCalledTimes(1);
		expect(props.onNew).toHaveBeenCalledTimes(1);
	});

	it("keeps each chat's delete button inside its own row", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "Trip planning", updatedAt: minutesAgo(5) }
		]);
		renderHistory();

		const row = (await screen.findByRole("button", { name: "Open Trip planning" })).closest("li");

		expect(row).not.toBeNull();
		expect(
			within(row as HTMLElement).getByRole("button", { name: "Delete Trip planning" })
		).toBeInTheDocument();
	});
});
