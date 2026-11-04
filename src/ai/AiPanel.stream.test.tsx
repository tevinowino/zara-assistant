import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";

function Harness() {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} />;
}

// An answer that stays pending until the test lets it finish, so the panel can be
// looked at while it is still being written.
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
}

describe("the assistant panel while an answer is being written", () => {
	it("shows the answer as it arrives instead of waiting for all of it", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		await ask("how do I brew tea?");

		act(() => emitTauriEvent("ai-chat-delta", "Steep it for"));

		expect(await screen.findByText("Steep it for")).toBeInTheDocument();
		act(() => emitTauriEvent("ai-chat-delta", "Steep it for three minutes."));
		expect(await screen.findByText("Steep it for three minutes.")).toBeInTheDocument();
	});

	it("stops saying Thinking once the first words appear", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		await ask("how do I brew tea?");
		expect(await screen.findByText("Thinking…")).toBeInTheDocument();

		act(() => emitTauriEvent("ai-chat-delta", "Steep it for"));

		await waitFor(() => expect(screen.queryByText("Thinking…")).not.toBeInTheDocument());
	});

	it("keeps the answer on screen, once, when the final reply arrives", async () => {
		const backend = backendWithPendingAnswer();
		render(<Harness />);
		await ask("how do I brew tea?");
		act(() => emitTauriEvent("ai-chat-delta", "Steep it for three"));
		await screen.findByText("Steep it for three");

		act(() => backend.finish("Steep it for three minutes."));

		expect(await screen.findByText("Steep it for three minutes.")).toBeInTheDocument();
		expect(screen.queryByText("Steep it for three")).not.toBeInTheDocument();
		expect(screen.getAllByText(/Steep it/)).toHaveLength(1);
	});

	it("shows a widget that is only half written as a placeholder, never as raw JSON", async () => {
		backendWithPendingAnswer();
		render(<Harness />);
		await ask("compare plans");

		act(() =>
			emitTauriEvent("ai-chat-delta", 'Here you go.\n\n```zara:table\n{"columns":["A","B"],"ro')
		);

		expect(await screen.findByText(/table · loading/)).toBeInTheDocument();
		expect(screen.queryByText(/columns/)).not.toBeInTheDocument();
	});

	it("ignores streamed text that arrives after the answer has finished", async () => {
		const backend = backendWithPendingAnswer();
		render(<Harness />);
		await ask("how do I brew tea?");
		act(() => backend.finish("Steep it for three minutes."));
		await screen.findByText("Steep it for three minutes.");

		act(() => emitTauriEvent("ai-chat-delta", "A late straggler"));

		expect(screen.queryByText("A late straggler")).not.toBeInTheDocument();
	});
});
