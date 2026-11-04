import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiPanel } from "./AiPanel";
import { AI_PANEL_HEIGHT } from "./panelSize";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";

function Harness({ onDesiredHeight }: { onDesiredHeight?: (height: number) => void }) {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} onDesiredHeight={onDesiredHeight} />;
}

const now = Date.now();
const tripChat = {
	id: "trip-1",
	title: "Trip planning",
	createdAt: now - 3_600_000,
	updatedAt: now - 3_600_000,
	messages: [
		{ id: "m1", role: "user", text: "Plan three days in Lisbon", createdAt: 1 },
		{ id: "m2", role: "assistant", text: "Day one: Alfama.", createdAt: 2 }
	]
};

function registerBackend(
	chats = [{ id: "trip-1", title: "Trip planning", updatedAt: now - 3_600_000 }]
) {
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("conv_list", () => chats);
	setInvokeHandler("conv_load", () => tripChat);
	setInvokeHandler("conv_delete", () => ({ success: true }));
	setInvokeHandler("ai_chat", () => ({
		text: "You have nothing on screen.",
		usedScreen: false,
		usedNotes: false,
		savedMemories: [],
		noteChanges: []
	}));
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
}

describe("the assistant panel's welcome view and past chats", () => {
	it("welcomes the user to a new chat with things to try", async () => {
		registerBackend();

		render(<Harness />);

		expect(await screen.findByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
		expect(screen.getByLabelText("Message Zara")).toBeInTheDocument();
	});

	it("sends a suggestion as the first message", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "What's on my screen?" }));

		expect(await screen.findByText("You have nothing on screen.")).toBeInTheDocument();
		const chatCalls = invokeCalls.filter((call) => call.command === "ai_chat");
		expect(chatCalls[0].args).toMatchObject({ message: "What's on my screen?" });
		expect(screen.queryByRole("heading", { name: "How can I help?" })).not.toBeInTheDocument();
	});

	it("opens a recent chat from the welcome view", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Open Trip planning" }));

		expect(await screen.findByText("Day one: Alfama.")).toBeInTheDocument();
		expect(screen.getByText("Trip planning")).toBeInTheDocument();
	});

	it("opens the list of past chats from the header and a chat from the list", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Past chats" }));
		await user.click(await screen.findByRole("button", { name: "Open Trip planning" }));

		expect(await screen.findByText("Day one: Alfama.")).toBeInTheDocument();
		expect(screen.getByLabelText("Message Zara")).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Past chats" })).not.toBeInTheDocument();
	});

	it("goes back to the chat without opening anything", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Past chats" }));

		await user.click(await screen.findByRole("button", { name: "Back to chat" }));

		expect(await screen.findByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
	});

	it("starts a new chat from the list of past chats", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Open Trip planning" }));
		await screen.findByText("Day one: Alfama.");
		await user.click(screen.getByRole("button", { name: "Past chats" }));

		await user.click(await screen.findByRole("button", { name: "New chat" }));

		expect(await screen.findByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
		expect(screen.queryByText("Day one: Alfama.")).not.toBeInTheDocument();
	});

	it("starts a new chat when the open one is deleted from the list", async () => {
		registerBackend();
		render(<Harness />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Open Trip planning" }));
		await screen.findByText("Day one: Alfama.");
		await user.click(screen.getByRole("button", { name: "Past chats" }));

		await user.click(await screen.findByRole("button", { name: "Delete Trip planning" }));
		await user.click(screen.getByRole("button", { name: "Confirm delete Trip planning" }));

		await waitFor(() =>
			expect(invokeCalls.filter((call) => call.command === "conv_delete")).toHaveLength(1)
		);
		await user.click(await screen.findByRole("button", { name: "Back to chat" }));
		expect(await screen.findByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
	});

	it("asks the notch for the welcome height, then the taller chat height", async () => {
		registerBackend();
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();
		await screen.findByRole("heading", { name: "How can I help?" });
		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.welcome);

		await user.click(screen.getByRole("button", { name: "Past chats" }));

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.conversation);
	});

	it("keeps past chats reachable when there is no API key yet", async () => {
		registerBackend();
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));
		render(<Harness />);
		const user = userEvent.setup();
		await screen.findByText("Add your OpenRouter API key");

		await user.click(screen.getByRole("button", { name: "Past chats" }));

		expect(await screen.findByRole("button", { name: "Open Trip planning" })).toBeInTheDocument();
	});
});
