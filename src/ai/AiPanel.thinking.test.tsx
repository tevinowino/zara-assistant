import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";

function Harness() {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} />;
}

// An answer that stays pending until the test lets it finish.
function backendWithPendingAnswer() {
	let finish: (text: string) => void = () => {};
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("conv_list", () => []);
	setInvokeHandler(
		"ai_chat",
		() =>
			new Promise((resolve) => {
				finish = (text) =>
					resolve({
						text,
						usedScreen: false,
						usedNotes: false,
						savedMemories: [],
						noteChanges: []
					});
			})
	);
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
	return { finish: (text: string) => finish(text) };
}

async function ask(question: string) {
	const user = userEvent.setup();
	await user.type(await screen.findByLabelText("Message Zara"), `${question}{Enter}`);
	return user;
}

describe("the Thinking section in the assistant panel", () => {
	it("appears folded as soon as a question is asked", async () => {
		backendWithPendingAnswer();
		render(<Harness />);

		await ask("what is on my screen?");

		const header = await screen.findByRole("button", { name: /Thinking…/ });
		expect(header).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
	});

	it("shows the steps when opened, and follows the stage the backend reports", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		const user = await ask("what is on my screen?");
		await user.click(await screen.findByRole("button", { name: /Thinking…/ }));

		act(() => emitTauriEvent("ai-chat-status", "looking-at-screen"));

		const steps = await screen.findByRole("list", { name: "Steps" });
		expect(steps).toHaveTextContent("Understanding your question");
		await waitFor(() => expect(steps).toHaveTextContent("Looking at your screen"));
	});

	it("shows the model's reasoning, as it arrives, as thoughts", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		const user = await ask("brew tea");
		await user.click(await screen.findByRole("button", { name: /Thinking…/ }));

		act(() =>
			emitTauriEvent(
				"ai-chat-reasoning",
				"**Working out the time**\n\nBlack tea needs three minutes."
			)
		);

		expect(await screen.findByText("Working out the time")).toBeInTheDocument();
		expect(screen.getByText("Black tea needs three minutes.")).toBeInTheDocument();
	});

	it("keeps up with a model that streams its reasoning in thousands of pieces, and shows the last of it", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		const user = await ask("what is on my screen?");
		await user.click(await screen.findByRole("button", { name: /Thinking…/ }));
		let so_far = "";

		act(() => {
			for (let piece = 0; piece < 1500; piece += 1) {
				so_far += `step${piece} `;
				emitTauriEvent("ai-chat-reasoning", so_far);
			}
		});

		expect(await screen.findByText(/step1499/)).toBeInTheDocument();
	});

	it("shows the answer once it starts, however much reasoning came before it", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		await ask("what is on my screen?");
		act(() => {
			emitTauriEvent("ai-chat-status", "looking-at-screen");
			for (let piece = 0; piece < 800; piece += 1) {
				emitTauriEvent("ai-chat-reasoning", `thinking about the screen ${piece}`);
			}
			emitTauriEvent("ai-chat-delta", "A terminal window.");
		});

		expect(await screen.findByText("A terminal window.")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: /Thought for/ })).toBeInTheDocument();
	});

	it("becomes Thought for … when the first words appear, and stays open if it was open", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		const user = await ask("brew tea");
		await user.click(await screen.findByRole("button", { name: /Thinking…/ }));

		act(() => emitTauriEvent("ai-chat-delta", "Steep it for"));

		const header = await screen.findByRole("button", { name: /Thought for/ });
		expect(header).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("list", { name: "Steps" })).toBeInTheDocument();
		expect(screen.getByText("Steep it for")).toBeInTheDocument();
	});

	it("stays above the finished answer, folded", async () => {
		const backend = backendWithPendingAnswer();
		render(<Harness />);
		await ask("brew tea");
		act(() => emitTauriEvent("ai-chat-delta", "Steep it for three minutes."));
		await screen.findByText("Steep it for three minutes.");

		act(() => backend.finish("Steep it for three minutes."));

		const header = await screen.findByRole("button", { name: /Thought for/ });
		expect(header).toHaveAttribute("aria-expanded", "false");
		expect(screen.getAllByRole("button", { name: /Thought for/ })).toHaveLength(1);
	});

	it("is not saved with the conversation", async () => {
		const backend = backendWithPendingAnswer();
		render(<Harness />);
		await ask("brew tea");

		act(() => backend.finish("Steep it for three minutes."));

		await waitFor(() =>
			expect(invokeCalls.some((call) => call.command === "conv_save")).toBe(true)
		);
		const saved = invokeCalls.find((call) => call.command === "conv_save");
		const messages = (saved?.args as { messages: object[] }).messages;
		expect(messages).toHaveLength(2);
		expect(messages.every((message) => !("thinking" in message))).toBe(true);
	});
});
