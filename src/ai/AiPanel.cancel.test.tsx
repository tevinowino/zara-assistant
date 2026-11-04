import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";

function Harness() {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} />;
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);

const outcome = (text: string) => ({
	text,
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
});

// Each question stays pending until the test settles it, in whatever order it likes.
function backendWithQuestionsInFlight() {
	const settle: Array<{ answer: (text: string) => void; cancelled: () => void }> = [];
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("conv_list", () => []);
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
	setInvokeHandler("ai_cancel_chat", () => undefined);
	setInvokeHandler(
		"ai_chat",
		() =>
			new Promise((resolve, reject) => {
				settle.push({
					answer: (text) => resolve(outcome(text)),
					cancelled: () => reject({ kind: "cancelled", message: "Stopped." })
				});
			})
	);
	return settle;
}

async function ask(user: ReturnType<typeof userEvent.setup>, question: string) {
	await user.type(await screen.findByLabelText("Message Zara"), `${question}{Enter}`);
}

describe("a question that is still being answered when the chat changes", () => {
	it("is stopped when a new chat is started", async () => {
		backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "premier league matches");

		await user.click(await screen.findByRole("button", { name: "New conversation" }));

		await waitFor(() => expect(calls("ai_cancel_chat")).toHaveLength(1));
	});

	it("never turns up as the answer in the next chat", async () => {
		const settle = backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "premier league matches");
		await user.click(await screen.findByRole("button", { name: "New conversation" }));
		await ask(user, "what is on my screen?");
		await waitFor(() => expect(settle).toHaveLength(2));

		// The first question's answer finally arrives, after the second was asked.
		await act(async () => settle[0].answer("Arsenal 2, Chelsea 1."));

		expect(screen.queryByText("Arsenal 2, Chelsea 1.")).not.toBeInTheDocument();
		await act(async () => settle[1].answer("A terminal window."));
		expect(await screen.findByText("A terminal window.")).toBeInTheDocument();
		expect(screen.queryByText("Arsenal 2, Chelsea 1.")).not.toBeInTheDocument();
	});

	it("reports nothing when the service says the question was stopped", async () => {
		const settle = backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "premier league matches");
		await user.click(await screen.findByRole("button", { name: "New conversation" }));
		await waitFor(() => expect(settle).toHaveLength(1));

		await act(async () => settle[0].cancelled());

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});

describe("the Stop button", () => {
	it("replaces Send while a question is being answered", async () => {
		backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();

		await ask(user, "what is on my screen?");

		expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
		expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
	});

	it("stops the question and puts it back in the box to change or send again", async () => {
		backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "what is on my screen?");

		await user.click(await screen.findByRole("button", { name: "Stop" }));

		await waitFor(() => expect(calls("ai_cancel_chat")).toHaveLength(1));
		expect(screen.getByLabelText("Message Zara")).toHaveValue("what is on my screen?");
		expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
		expect(document.querySelector(".zai-user")).toBeNull();
	});

	it("does not show the answer of a question that was stopped", async () => {
		const settle = backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "what is on my screen?");
		await user.click(await screen.findByRole("button", { name: "Stop" }));

		await act(async () => settle[0].answer("A terminal window."));

		expect(screen.queryByText("A terminal window.")).not.toBeInTheDocument();
	});

	it("lets the same question be sent again", async () => {
		const settle = backendWithQuestionsInFlight();
		render(<Harness />);
		const user = userEvent.setup();
		await ask(user, "what is on my screen?");
		await user.click(await screen.findByRole("button", { name: "Stop" }));

		await user.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(settle).toHaveLength(2));
		await act(async () => settle[1].answer("A terminal window."));

		expect(await screen.findByText("A terminal window.")).toBeInTheDocument();
	});
});
