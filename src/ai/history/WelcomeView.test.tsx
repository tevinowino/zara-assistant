import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WelcomeView } from "./WelcomeView";
import { setInvokeHandler } from "../../test/shims/tauriCore";

const now = Date.now();

function renderWelcome(overrides: Partial<Parameters<typeof WelcomeView>[0]> = {}) {
	const props = {
		busy: false,
		onAsk: vi.fn(),
		onOpenChat: vi.fn(),
		onSeeAll: vi.fn(),
		...overrides
	};
	render(<WelcomeView {...props} />);
	return props;
}

describe("WelcomeView", () => {
	it("asks what it can help with and offers things to try", async () => {
		setInvokeHandler("conv_list", () => []);

		renderWelcome();

		expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "What's on my screen?" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Summarize my notes" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Start a 25 minute focus timer" })
		).toBeInTheDocument();
	});

	it("sends a suggestion as the user's question when it is clicked", async () => {
		setInvokeHandler("conv_list", () => []);
		const props = renderWelcome();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Summarize my notes" }));

		expect(props.onAsk).toHaveBeenCalledWith("Summarize my notes");
	});

	it("disables the suggestions while an answer is being written", () => {
		setInvokeHandler("conv_list", () => []);

		renderWelcome({ busy: true });

		expect(screen.getByRole("button", { name: "Summarize my notes" })).toBeDisabled();
	});

	it("shows the three most recent chats and opens one when it is clicked", async () => {
		setInvokeHandler("conv_list", () => [
			{ id: "c1", title: "First", updatedAt: now - 60_000 },
			{ id: "c2", title: "Second", updatedAt: now - 120_000 },
			{ id: "c3", title: "Third", updatedAt: now - 180_000 },
			{ id: "c4", title: "Fourth", updatedAt: now - 240_000 }
		]);
		const props = renderWelcome();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Open Second" }));

		expect(props.onOpenChat).toHaveBeenCalledWith("c2");
		expect(screen.getByRole("button", { name: "Open Third" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Open Fourth" })).not.toBeInTheDocument();
	});

	it("links to all chats when there are any", async () => {
		setInvokeHandler("conv_list", () => [{ id: "c1", title: "First", updatedAt: now - 60_000 }]);
		const props = renderWelcome();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "See all chats" }));

		expect(props.onSeeAll).toHaveBeenCalledTimes(1);
	});

	it("leaves out the recent section when there are no chats", async () => {
		setInvokeHandler("conv_list", () => []);

		renderWelcome();
		await screen.findByRole("heading", { name: "How can I help?" });

		expect(screen.queryByText("Recent")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "See all chats" })).not.toBeInTheDocument();
	});

	it("still welcomes the user when the chats cannot be loaded", async () => {
		setInvokeHandler("conv_list", () => {
			throw new Error("disk error");
		});

		renderWelcome();

		expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
		expect(screen.queryByText("Recent")).not.toBeInTheDocument();
	});
});
